// Live vitals from a USB-connected Arduino (VITALS project hardware:
// HW-827 pulse sensor + DHT11), read server-side over a serial port and
// polled from here.
//
// Field mapping:
//   Heartbeat   -> Heart Rate field
//   Temperature -> Temperature field (Celsius)
//   SpO2        -> SpO2 field (device's live reading)
//
// This script handles:
// listing ports, connecting/disconnecting, and streaming
// live single readings into the form + on-screen readouts.
// The actual Normal/Abnormal result comes from clicking "Run Check",
// handled separately in app.js
// (handleHardwareCheck -> /api/check/clinical).

const portSelect = document.getElementById("port-select");
const refreshPortsBtn = document.getElementById("refresh-ports-btn");
const connectBtn = document.getElementById("connect-btn");
const disconnectBtn = document.getElementById("disconnect-btn");
const statusEl = document.getElementById("auto-status");
const form = document.querySelector("form");

const readoutHeartbeat = document.getElementById("readout-heartbeat");
const readoutTemperature = document.getElementById("readout-temperature");
const readoutSpo2 = document.getElementById("readout-spo2");

const vHeartbeat = document.getElementById("v-heartbeat");
const vTemperature = document.getElementById("v-temperature");
const vSpo2 = document.getElementById("v-spo2");

// ECG capture status (no live chart - see renderEcgCapture below)
const ecgProgressEl = document.getElementById("ecg-progress");
const ecgFileNoteEl = document.getElementById("ecg-file-note");

// Real 10-second raw ECG capture status, shared with app.js
// (handleHardwareCheck triggers/polls the same
// /api/hardware/ecg/capture/* endpoints and keeps this in sync).
window.ecgCapture = {
  active: false,
  elapsed: 0,
  duration: 10,
  count: 0,
  result: null,
  error: null
};

let pollTimer = null;

// How long the locked average stays on screen once the
// AVERAGE_WINDOW readings have been collected and averaged.
const DISPLAY_HOLD_MS = 15000;

let lockTimer = null;
let readingComplete = false;

function resetLockState() {
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }
  readingComplete = false;
}

// Starts the 15s "hold" once the average has locked in
// (sample_count reaches average_window). Only arms once per
// connection - stays armed until a disconnect/connect resets it.
function armLockTimer() {
  if (lockTimer || readingComplete) return;

  lockTimer = setTimeout(() => {
    lockTimer = null;
    readingComplete = true;
    showReadingComplete();
  }, DISPLAY_HOLD_MS);
}

function showReadingComplete() {
  setIdle();

  statusEl.textContent =
    "Reading complete - disconnect and reconnect to take the next 10 readings.";

  statusEl.className =
    "auto-status connected";
}


// ============================================================
// ECG CAPTURE STATUS
//
// The real 10-second raw ECG capture is only started when "Run
// Fusion Analysis" is clicked (see app.js) - it isn't running in
// the background. This just reflects whatever that capture's
// current state is (idle / capturing / done / error) so the note
// under the readouts stays accurate even while that's happening.
// ============================================================

function renderEcgCapture(capture) {

  if (!capture) return;

  window.ecgCapture = capture;

  if (ecgProgressEl) {

    if (capture.active) {

      ecgProgressEl.textContent =
        "Capturing real ECG: " + capture.elapsed + "/" +
        capture.duration + "s (" + capture.count +
        " samples so far)\u2026";

      ecgProgressEl.classList.remove("ready");

    } else if (capture.result) {

      ecgProgressEl.textContent =
        "ECG capture complete: " + capture.result.count +
        " samples over " + capture.result.duration +
        "s (~" + capture.result.fs + " Hz).";

      ecgProgressEl.classList.add("ready");

    } else if (capture.error) {

      ecgProgressEl.textContent =
        "ECG capture error: " + capture.error;

      ecgProgressEl.classList.remove("ready");

    } else {

      ecgProgressEl.textContent =
        "Click \u201cRun Fusion Analysis\u201d to capture a real "
        + capture.duration + "-second ECG.";

      ecgProgressEl.classList.remove("ready");
    }
  }

  if (ecgFileNoteEl) {

    const result = capture.result;

    ecgFileNoteEl.textContent =
      result && result.dat_file
        ? "Saved to backend/ecg_captures/" + result.dat_file +
          (result.xlsx_file ? " and " + result.xlsx_file : "")
        : "";
  }
}


// ============================================================
// REFRESH SERIAL PORTS
// ============================================================

async function refreshPorts() {
  try {
    const data = await apiFetch(
      "/api/hardware/ports",
      { method: "GET" }
    );

    portSelect.innerHTML = "";

    (data.ports || []).forEach((p) => {
      const opt = document.createElement("option");

      opt.value = p;
      opt.textContent = p;

      portSelect.appendChild(opt);
    });

    if (!data.ports || data.ports.length === 0) {
      const opt = document.createElement("option");

      opt.value = "COM5";
      opt.textContent = "COM5 (no ports detected)";

      portSelect.appendChild(opt);
    }

    if (!data.serial_available) {
      statusEl.textContent =
        "pyserial isn't installed on the server — install it to enable live streaming.";

      statusEl.className =
        "auto-status error";
    }

  } catch (err) {
    // Keep whatever options are already there
  }
}


// ============================================================
// CALCULATING STATE
// ============================================================

function setCalculating(count, windowSize) {
  [
    readoutHeartbeat,
    readoutTemperature,
    readoutSpo2
  ].forEach((r) =>
    r.classList.add("calculating")
  );

  const label =
    (count !== undefined && windowSize !== undefined)
      ? `Calculating (${count}/${windowSize})`
      : "Calculating";

  vHeartbeat.textContent = label;
  vTemperature.textContent = label;
  vSpo2.textContent = label;
}


// ============================================================
// IDLE STATE
// ============================================================

function setIdle() {
  [
    readoutHeartbeat,
    readoutTemperature,
    readoutSpo2
  ].forEach((r) =>
    r.classList.remove("calculating")
  );

  vHeartbeat.innerHTML =
    `--<span class="r-unit">bpm</span>`;

  vTemperature.innerHTML =
    `--<span class="r-unit">&deg;C</span>`;

  vSpo2.innerHTML =
    `--<span class="r-unit">%</span>`;
}


// ============================================================
// DISPLAY LIVE VALUES
// Only called once sample_count has reached average_window (see
// poll() below) - temperature/SpO2 are always the final locked
// average here. Heart Rate still has its own independent
// heart_sample_count (the pulse sensor can take longer, or
// never, detect a beat), so it stays hidden behind a "waiting
// for pulse" note until it locks too.
// Temperature is already Celsius - no Fahrenheit conversion
// needed.
// ============================================================

function renderLiveReadout(latest) {

  [
    readoutHeartbeat,
    readoutTemperature,
    readoutSpo2
  ].forEach((r) =>
    r.classList.remove("calculating")
  );

  const heartReady =
    latest.heartbeat_avg !== null &&
    latest.heartbeat_avg !== undefined &&
    latest.heart_sample_count >= latest.average_window;

  if (!heartReady) {

    vHeartbeat.innerHTML =
      `--<span class="r-unit">bpm</span> <span class="r-unit">(waiting for pulse)</span>`;

  } else {

    vHeartbeat.innerHTML =
      `${latest.heartbeat_avg}<span class="r-unit">bpm</span>`;
  }

  // Temperature/SpO2 collect together - don't show anything
  // until all average_window readings are in, then show only
  // the final locked average (never a partial/live-updating
  // number while still collecting).
  const vitalsReady =
    latest.sample_count >= latest.average_window;

  if (!vitalsReady || latest.temperature_avg === null || latest.temperature_avg === undefined) {

    vTemperature.innerHTML =
      `--<span class="r-unit">&deg;C</span>`;

  } else {

    vTemperature.innerHTML =
      `${Number(latest.temperature_avg).toFixed(1)}<span class="r-unit">&deg;C</span>`;
  }

  if (!vitalsReady || latest.spo2_avg === null || latest.spo2_avg === undefined) {

    vSpo2.innerHTML =
      `--<span class="r-unit">%</span>`;

  } else {

    vSpo2.innerHTML =
      `${latest.spo2_avg}<span class="r-unit">%</span>`;
  }
}


// ============================================================
// PUT LIVE VALUES INTO FORM
// ============================================================

function applyReading(latest) {

  if (!latest) return;

  // Use the rolling average (smoothed over the last
  // average_window readings) for the values that actually
  // get submitted to "Run Check", not a single noisy sample.
  // Each field is only pushed into the form once its sensor
  // has produced a real reading - a still-missing one (most
  // often Heart Rate, while waiting for the first pulse) is
  // left blank instead of writing "null" into the form.

  if (latest.spo2_avg !== null && latest.spo2_avg !== undefined) {
    form.spo2.value = latest.spo2_avg;
  }

  if (latest.heartbeat_avg !== null && latest.heartbeat_avg !== undefined) {
    form.heart_rate.value = latest.heartbeat_avg;
  }

  // Temperature stays in Celsius
  if (latest.temperature_avg !== null && latest.temperature_avg !== undefined) {
    form.temperature.value = latest.temperature_avg;
  }
}


// ============================================================
// POLL HARDWARE
// ============================================================

async function poll() {

  try {

    const data = await apiFetch(
      "/api/hardware/stream",
      { method: "GET" }
    );

    if (data.error) {

      statusEl.textContent =
        "Error: " + data.error;

      statusEl.className =
        "auto-status error";

      setIdle();

    } else if (data.running) {

      // ECG capture progress keeps updating even while the
      // 15s locked-average hold is showing.
      renderEcgCapture(data.ecg_capture);

      if (readingComplete) {

        // Already showed the locked average for the full
        // hold period - stay idle until disconnect/connect.
        showReadingComplete();

      } else {

        statusEl.textContent =
          "Live on " + data.port;

        statusEl.className =
          "auto-status connected";

        if (data.latest) {

          applyReading(data.latest);

          const vitalsReady =
            data.latest.sample_count >= data.latest.average_window;

          if (vitalsReady) {

            // Do not show any readings until all 10 readings are
            // taken - only once the batch is complete do we
            // reveal the locked average, and start the 15s hold.
            renderLiveReadout(data.latest);
            armLockTimer();

          } else {

            setCalculating(
              data.latest.sample_count,
              data.latest.average_window
            );
          }

        } else {

          setCalculating();
        }
      }

    } else {

      statusEl.textContent =
        "Not connected";

      statusEl.className =
        "auto-status";

      setIdle();
    }

  } catch (err) {

    statusEl.textContent =
      "Connection lost";

    statusEl.className =
      "auto-status error";
  }
}


// ============================================================
// CONNECT DEVICE
// ============================================================

connectBtn.addEventListener(
  "click",
  async () => {

    const port =
      portSelect.value;

    if (!port) return;

    resetLockState();

    // New connection = ECG capture state resets too (a fresh
    // capture only starts when "Run Fusion Analysis" is clicked).
    renderEcgCapture({
      active: false,
      elapsed: 0,
      duration: 10,
      count: 0,
      result: null,
      error: null
    });

    connectBtn.disabled = true;

    statusEl.textContent =
      "Connecting...";

    statusEl.className =
      "auto-status";

    try {

      await apiFetch(
        "/api/hardware/connect",
        {
          method: "POST",

          body: JSON.stringify({
            port,
            baud: 9600
          })
        }
      );

      statusEl.textContent =
        "Live on " + port;

      statusEl.className =
        "auto-status connected";

      disconnectBtn.disabled =
        false;

      setCalculating();

      if (!pollTimer) {
        pollTimer =
          setInterval(
            poll,
            1000
          );
      }

    } catch (err) {

      statusEl.textContent =
        "Could not connect: " +
        err.message;

      statusEl.className =
        "auto-status error";

    } finally {

      connectBtn.disabled =
        false;
    }
  }
);


// ============================================================
// DISCONNECT DEVICE
// ============================================================

disconnectBtn.addEventListener(
  "click",
  async () => {

    disconnectBtn.disabled =
      true;

    resetLockState();

    try {

      await apiFetch(
        "/api/hardware/disconnect",
        { method: "POST" }
      );

    } catch (err) {
      // Ignore disconnect error
    }

    statusEl.textContent =
      "Not connected";

    statusEl.className =
      "auto-status";

    setIdle();

    if (pollTimer) {

      clearInterval(
        pollTimer
      );

      pollTimer = null;
    }
  }
);


// ============================================================
// REFRESH PORT BUTTON
// ============================================================

refreshPortsBtn.addEventListener(
  "click",
  refreshPorts
);


// ============================================================
// INITIAL LOAD
// ============================================================

refreshPorts();


// Start polling right away in case a connection
// is already running after page refresh.

pollTimer =
  setInterval(
    poll,
    1000
  );

poll();