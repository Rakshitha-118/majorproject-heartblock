const API_BASE = "";  // same origin


// ============================================================
// TOAST / INLINE ERROR UI
// ============================================================

function ensureToastRoot() {
  let root = document.getElementById("toast-root");

  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    root.className = "toast-root";

    document.body.appendChild(root);
  }

  return root;
}


function showError(message, title) {
  const root = ensureToastRoot();

  const toast = document.createElement("div");

  toast.className =
    "toast toast-error";

  toast.innerHTML = `
    <div class="toast-icon">

      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg">

        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="2"/>

        <path
          d="M12 8v5"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"/>

        <circle
          cx="12"
          cy="16"
          r="1.1"
          fill="currentColor"/>

      </svg>

    </div>

    <div class="toast-body">

      <strong>
        ${title || "Something went wrong"}
      </strong>

      <p>
        ${String(message || "Please try again.")
          .replace(/\n/g, "<br>")}
      </p>

    </div>

    <button
      class="toast-close"
      aria-label="Dismiss"
      onclick="this.closest('.toast').remove()">

      &times;

    </button>
  `;

  root.appendChild(toast);


  const remove = () => {

    if (!toast.isConnected) {
      return;
    }

    toast.classList.add("toast-out");

    setTimeout(() => {
      toast.remove();
    }, 220);
  };


  setTimeout(remove, 7000);
}


// ============================================================
// PAGE ERROR HELPERS
// ============================================================

function showPageError(message, title) {

  const banner =
    document.getElementById(
      "page-error-banner"
    );


  if (!banner) {

    showError(
      message,
      title
    );

    return;
  }


  const titleElement =
    document.getElementById(
      "page-error-title"
    );


  const messageElement =
    document.getElementById(
      "page-error-message"
    );


  if (titleElement) {

    titleElement.textContent =
      title || "Upload error";
  }


  if (messageElement) {

    messageElement.textContent =
      message || "Please try again.";
  }


  banner.hidden = false;


  banner.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}


function hidePageError() {

  const banner =
    document.getElementById(
      "page-error-banner"
    );


  if (banner) {

    banner.hidden = true;
  }
}


// ============================================================
// MODERN WRONG FILE POPUP
// ============================================================

function showWrongFilePopup() {

  const existing =
    document.getElementById(
      "wrong-file-popup"
    );


  if (existing) {
    existing.remove();
  }


  if (
    !document.getElementById(
      "wrong-file-popup-style"
    )
  ) {

    const style =
      document.createElement("style");

    style.id =
      "wrong-file-popup-style";


    style.textContent = `

      .wrong-file-overlay {

        position: fixed;
        inset: 0;
        z-index: 999999;

        display: flex;
        align-items: center;
        justify-content: center;

        padding: 20px;

        background:
          rgba(15, 23, 42, 0.48);

        backdrop-filter:
          blur(7px);

        -webkit-backdrop-filter:
          blur(7px);

        opacity: 0;

        transition:
          opacity 0.22s ease;

      }


      .wrong-file-card {

        position: relative;

        width: 390px;

        max-width:
          calc(100vw - 40px);

        padding:
          34px 30px 28px;

        background:
          #ffffff;

        border:
          1px solid rgba(
            15,
            23,
            42,
            0.08
          );

        border-radius:
          24px;

        text-align:
          center;

        box-shadow:
          0 30px 70px
          rgba(
            15,
            23,
            42,
            0.22
          ),

          0 8px 25px
          rgba(
            15,
            23,
            42,
            0.10
          );

        transform:
          translateY(18px)
          scale(0.94);

        opacity: 0;

        transition:
          transform 0.25s ease,
          opacity 0.25s ease;

      }


      #wrong-file-popup.active
      .wrong-file-overlay {

        opacity: 1;

      }


      #wrong-file-popup.active
      .wrong-file-card {

        transform:
          translateY(0)
          scale(1);

        opacity: 1;

      }


      .wrong-file-close {

        position: absolute;

        top: 14px;
        right: 15px;

        width: 34px;
        height: 34px;

        display: flex;

        align-items: center;
        justify-content: center;

        border: none;

        border-radius: 50%;

        background:
          #f1f5f9;

        color:
          #64748b;

        font-size:
          22px;

        line-height:
          1;

        cursor:
          pointer;

        transition:
          all 0.18s ease;

      }


      .wrong-file-close:hover {

        background:
          #e2e8f0;

        color:
          #0f172a;

        transform:
          rotate(90deg);

      }


      .wrong-file-icon {

        width: 70px;
        height: 70px;

        margin:
          0 auto 20px;

        display: flex;

        align-items: center;
        justify-content: center;

        border-radius: 50%;

        background:
          #fff7ed;

        border:
          7px solid #fffbf5;

        color:
          #d97706;

        box-shadow:
          0 8px 25px
          rgba(
            217,
            119,
            6,
            0.12
          );

      }


      .wrong-file-icon svg {

        width:
          32px;

        height:
          32px;

      }


      .wrong-file-card h2 {

        margin:
          0 0 9px;

        color:
          #172033;

        font-size:
          24px;

        font-weight:
          700;

        letter-spacing:
          -0.4px;

      }


      .wrong-file-card p {

        margin:
          0 auto;

        max-width:
          310px;

        color:
          #64748b;

        font-size:
          14px;

        line-height:
          1.65;

      }


      .wrong-file-ok {

        width:
          100%;

        margin-top:
          25px;

        padding:
          13px 20px;

        border:
          none;

        border-radius:
          12px;

        background:
          #172033;

        color:
          #ffffff;

        font-size:
          14px;

        font-weight:
          600;

        cursor:
          pointer;

        box-shadow:
          0 6px 16px
          rgba(
            15,
            23,
            42,
            0.12
          );

        transition:
          all 0.18s ease;

      }


      .wrong-file-ok:hover {

        background:
          #0f172a;

        transform:
          translateY(-2px);

        box-shadow:
          0 10px 22px
          rgba(
            15,
            23,
            42,
            0.18
          );

      }


      .wrong-file-ok:active {

        transform:
          translateY(0);

      }


      @media (max-width: 480px) {

        .wrong-file-card {

          width:
            calc(100vw - 30px);

          padding:
            30px 22px 24px;

          border-radius:
            20px;

        }


        .wrong-file-icon {

          width:
            60px;

          height:
            60px;

        }


        .wrong-file-card h2 {

          font-size:
            21px;

        }

      }

    `;


    document.head.appendChild(style);
  }


  const popup =
    document.createElement("div");

  popup.id =
    "wrong-file-popup";


  popup.innerHTML = `

    <div
      class="wrong-file-overlay"
      onclick="closeWrongFilePopup()">

      <div
        class="wrong-file-card"
        onclick="event.stopPropagation()">


        <button
          type="button"
          class="wrong-file-close"
          onclick="closeWrongFilePopup()"
          aria-label="Close">

          &times;

        </button>


        <div class="wrong-file-icon">

          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg">

            <path
              d="M12 8V13"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"/>

            <circle
              cx="12"
              cy="16.5"
              r="1.1"
              fill="currentColor"/>

            <path
              d="M10.3 3.8L2.8 17C2.1 18.2 3 19.7 4.4 19.7H19.6C21 19.7 21.9 18.2 21.2 17L13.7 3.8C13 2.6 11 2.6 10.3 3.8Z"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linejoin="round"/>

          </svg>

        </div>


        <h2>
          Wrong File
        </h2>


        <p>
          Please upload a valid raw ECG
          signal file and try again.
        </p>


        <button
          type="button"
          class="wrong-file-ok"
          onclick="closeWrongFilePopup()">

          OK

        </button>

      </div>

    </div>

  `;


  document.body.appendChild(popup);


  requestAnimationFrame(() => {

    requestAnimationFrame(() => {

      popup.classList.add(
        "active"
      );

    });

  });
}


// ============================================================
// CLOSE WRONG FILE POPUP
// ============================================================

function closeWrongFilePopup() {

  const popup =
    document.getElementById(
      "wrong-file-popup"
    );


  if (!popup) {
    return;
  }


  popup.classList.remove(
    "active"
  );


  setTimeout(() => {

    if (popup.isConnected) {
      popup.remove();
    }

  }, 220);
}


// ============================================================
// AUTHENTICATION
// ============================================================

function getToken() {

  return localStorage.getItem(
    "ecg_token"
  );
}


function getUsername() {

  return localStorage.getItem(
    "ecg_username"
  );
}


function setSession(
  token,
  username
) {

  localStorage.setItem(
    "ecg_token",
    token
  );

  localStorage.setItem(
    "ecg_username",
    username
  );
}


function clearSession() {

  localStorage.removeItem(
    "ecg_token"
  );

  localStorage.removeItem(
    "ecg_username"
  );
}


function requireAuth() {

  if (!getToken()) {

    window.location.href =
      "/login.html";
  }
}


function logout() {

  clearSession();

  window.location.href =
    "/index.html";
}


// ============================================================
// API
// ============================================================

async function apiFetch(
  path,
  options = {}
) {

  const headers =
    options.headers || {};


  headers["Content-Type"] =
    "application/json";


  const token =
    getToken();


  if (token) {

    headers["Authorization"] =
      "Bearer " + token;
  }


  const res =
    await fetch(
      API_BASE + path,
      {
        ...options,
        headers
      }
    );


  const data =
    await res
      .json()
      .catch(() => ({}));


  if (!res.ok) {

    throw new Error(
      formatApiError(
        data.detail
      ) ||
      "Something went wrong"
    );
  }


  return data;
}


// ============================================================
// FORMAT FASTAPI ERRORS
// ============================================================

function formatApiError(
  detail
) {

  if (!detail) {
    return null;
  }


  if (
    typeof detail ===
    "string"
  ) {

    return detail;
  }


  if (Array.isArray(detail)) {

    return detail
      .map((e) => {

        if (
          typeof e ===
          "string"
        ) {

          return e;
        }


        const field =
          Array.isArray(e.loc)
            ? e.loc[
                e.loc.length - 1
              ]
            : "";


        return field
          ? `${field}: ${e.msg}`
          : e.msg;

      })
      .join("\n");
  }


  return JSON.stringify(
    detail
  );
}


// ============================================================
// AUTH FORMS
// ============================================================

async function handleRegister(
  event
) {

  event.preventDefault();


  const form =
    event.target;


  const errorEl =
    document.getElementById(
      "error-msg"
    );


  errorEl.textContent = "";


  try {

    const data =
      await apiFetch(
        "/api/register",
        {
          method: "POST",

          body:
            JSON.stringify({
              username:
                form.username.value
                  .trim(),

              email:
                form.email.value
                  .trim(),

              password:
                form.password.value
            })
        }
      );


    setSession(
      data.token,
      data.username
    );


    window.location.href =
      "/dashboard.html";


  } catch (err) {

    errorEl.textContent =
      err.message;
  }
}


async function handleLogin(
  event
) {

  event.preventDefault();


  const form =
    event.target;


  const errorEl =
    document.getElementById(
      "error-msg"
    );


  errorEl.textContent = "";


  try {

    const data =
      await apiFetch(
        "/api/login",
        {
          method: "POST",

          body:
            JSON.stringify({
              username:
                form.username.value
                  .trim(),

              password:
                form.password.value
            })
        }
      );


    setSession(
      data.token,
      data.username
    );


    window.location.href =
      "/dashboard.html";


  } catch (err) {

    errorEl.textContent =
      err.message;
  }
}


// ============================================================
// HARDWARE CHECK
// ============================================================

async function handleHardwareCheck(
  event
) {

  event.preventDefault();


  const form =
    event.target;


  const btn =
    form.querySelector(
      "button[type=submit]"
    );


  const resultBox =
    document.getElementById(
      "result-box"
    );


  btn.disabled = true;


  btn.innerHTML =
    "Checking <span class='loader'></span>";


  hidePageError();


  try {

    let ecgCsv = null;


    const fileInput =
      form.ecg_file;


    if (
      fileInput &&
      fileInput.files &&
      fileInput.files.length > 0
    ) {

      const file =
        fileInput.files[0];


      ecgCsv =
        await readFileAsText(
          file
        );
    }


    // Hardware page: no ECG upload box here - "Run Fusion
    // Analysis" triggers a real 10-second raw ECG capture right
    // now (backend switches the Arduino into Graph Mode and
    // streams genuine unaveraged samples), so the waveform sent
    // to the fusion model - and shown in the results below - is
    // real signal, not a handful of smoothed averages.

    let ecgFs = 250;

    if (!ecgCsv) {

      await apiFetch(
        "/api/hardware/ecg/capture/start",
        { method: "POST" }
      );

      let status = null;

      while (true) {

        status =
          await apiFetch(
            "/api/hardware/ecg/capture/status",
            { method: "GET" }
          );

        window.ecgCapture = status;

        if (typeof renderEcgCapture === "function") {
          renderEcgCapture(status);
        }

        if (!status.active) break;

        btn.innerHTML =
          "Capturing ECG " + status.elapsed + "/" +
          status.duration + "s <span class='loader'></span>";

        await new Promise(
          (resolve) => setTimeout(resolve, 500)
        );
      }

      if (!status.result || !status.result.count) {

        throw new Error(
          (status.error || "No ECG samples were captured.") +
          " Check the ECG leads are connected and try again."
        );
      }

      ecgCsv = status.result.csv;
      ecgFs = status.result.fs;

      btn.innerHTML =
        "Checking <span class='loader'></span>";
    }


    const spo2Val =
      parseFloat(
        form.spo2.value
      );

    const heartRateVal =
      parseFloat(
        form.heart_rate.value
      );

    const temperatureVal =
      parseFloat(
        form.temperature.value
      );


    if (
      isNaN(spo2Val) ||
      isNaN(heartRateVal) ||
      isNaN(temperatureVal)
    ) {

      throw new Error(
        "SpO2, Heart Rate, and Temperature are missing. Connect your device and wait for a live reading before running the check."
      );
    }


    const payload = {

      spo2:
        spo2Val,

      heart_rate:
        heartRateVal,

      temperature:
        temperatureVal,

      ecg_csv:
        ecgCsv,

      // Real measured rate from the 10-second capture above
      // (falls back to 250 only for the unused manual-file
      // branch, which never applies on this page).
      ecg_fs:
        ecgFs,

      source:
        "hardware"

    };


    const data =
      await apiFetch(
        "/api/check/clinical",
        {
          method: "POST",

          body:
            JSON.stringify(
              payload
            )
        }
      );

      // Keep a copy for compatibility, then render the complete screening
      // result directly below Run Fusion Analysis on this page.
      localStorage.setItem("screeningResult", JSON.stringify(data));
      renderInlineScreeningResult(data);
      return;


  } catch (err) {

    const errorMessage =
      err.message || "";


    const isFileFormatIssue =

      /clinical\/tabular CSV/i
        .test(errorMessage)

      ||

      /raw ECG signal/i
        .test(errorMessage)

      ||

      /wrong file format/i
        .test(errorMessage)

      ||

      /invalid.*ecg/i
        .test(errorMessage)

      ||

      /ecg.*invalid/i
        .test(errorMessage);


    if (
      isFileFormatIssue
    ) {

      hidePageError();

      showWrongFilePopup();


    } else {

      showError(
        errorMessage ||
        "Unable to perform hardware check.",
        "Analysis Failed"
      );


      resultBox.className =
        "result-box show Abnormal";


      resultBox.innerHTML = `

        <h2>
          ⚠️ Check Failed
        </h2>

        <div class="detail">
          ${errorMessage ||
          "Unable to perform hardware check."}
        </div>

      `;


      resultBox.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }


  } finally {

    btn.disabled = false;

    btn.textContent =
      "Run Fusion Analysis";
  }
}


// ============================================================
// ECG FILE READER
// ============================================================

function readFileAsText(
  file
) {

  return new Promise(
    (resolve, reject) => {

      const reader =
        new FileReader();


      reader.onload = () => {

        resolve(
          reader.result
        );
      };


      reader.onerror =
        reject;


      reader.readAsText(
        file
      );

    }
  );
}


// ============================================================
// BRANCH DETAIL
// ============================================================

function buildBranchDetailHtml(data) {

  const vitalsAbnormal =
    data.vitals_abnormal === true;


  const vitalsLabel =
    vitalsAbnormal
      ? "Abnormal"
      : "Normal";


  const vitalsClass =
    vitalsAbnormal
      ? "Abnormal"
      : "Normal";


  let ecgClass =
    "neutral";

  let ecgLabel =
    "No file uploaded";

  let ecgSub =
    "";


  if (
    data.ecg_provided
  ) {

    const ecgAbnormal =
      data.ecg_abnormal === true;


    ecgClass =
      ecgAbnormal
        ? "Abnormal"
        : "Normal";


    ecgLabel =
      ecgAbnormal
        ? "Abnormal"
        : "Normal";


    const pct =

      data.branch_detail &&
      data.branch_detail
        .ecg_prob_abnormal;


    if (
      pct !== undefined &&
      pct !== null
    ) {

      ecgSub =
        pct +
        "% abnormal probability";
    }

  }


  return `

    <div class="branch-detail-grid">

      <div class="branch-pill">

        <div class="bp-label">
          Vitals
        </div>

        <div class="bp-value ${vitalsClass}">
          ${vitalsLabel}
        </div>

      </div>


      <div class="branch-pill">

        <div class="bp-label">
          ECG Signal
        </div>

        <div class="bp-value ${ecgClass}">
          ${ecgLabel}
        </div>

        ${
          ecgSub

            ? `<div class="bp-sub">
                ${ecgSub}
               </div>`

            : ""
        }

      </div>

    </div>


    <div class="branch-detail-note">
      The final result is produced by the fusion model using ECG and vital features together.
    </div>

  `;
}


// ============================================================
// REMEDY / GUIDANCE TIPS
// ============================================================

const REMEDY_TIPS = {

  "Low SpO2":
    "Try slow, deep breaths and get some fresh air. If it stays below 94% or you feel short of breath, seek medical attention promptly.",


  "Heart rate out of normal resting range":
    "Sit down, relax, and avoid caffeine or stimulants, then recheck after a few minutes of calm. If it stays very high/low or you feel dizzy or faint, contact a doctor.",


  "Fever":
    "Rest, stay hydrated, and monitor your temperature. Seek care if it stays above 39.4°C or you have other severe symptoms.",


  "Low body temperature":
    "Warm up gradually with blankets and warm (not hot) drinks. Seek immediate care if it stays below 35°C — this can be a medical emergency."

};


const REMEDY_FALLBACK =

  "This result is based on ECG + vitals fusion analysis and isn't a diagnosis. Please consult a doctor or cardiologist for a full evaluation, especially if you have symptoms like chest pain, palpitations, shortness of breath, or fainting.";


function buildRemedyHtml(
  result,
  vitalsIssues
) {

  if (
    result !==
    "Abnormal"
  ) {

    return "";
  }


  const tips =
    (vitalsIssues || [])

      .map(
        (issue) =>
          REMEDY_TIPS[
            issue
          ]
      )

      .filter(
        Boolean
      );


  const bullets =

    tips.length

      ? tips
          .map(
            (tip) =>
              `<li>${tip}</li>`
          )
          .join("")

      : `<li>${REMEDY_FALLBACK}</li>`;


  return `

    <div class="remedy-box">

      <h4>
        Suggested next steps
      </h4>

      <ul>
        ${bullets}
      </ul>

      <p class="remedy-disclaimer">

        ⚠️ Not a medical diagnosis.
        If you have chest pain,
        severe shortness of breath,
        or fainting,
        seek emergency care immediately.

      </p>

    </div>

  `;
}


// ============================================================
// ECG + VITALS FUSION ANALYSIS
// ============================================================

async function handleClinicalCheck(
  event
) {

  event.preventDefault();


  const form =
    event.target;


  const btn =
    form.querySelector(
      "button[type=submit]"
    );


  const resultBox =
    document.getElementById(
      "result-box"
    );


  btn.disabled = true;


  btn.innerHTML =
    "Analyzing <span class='loader'></span>";


  hidePageError();


  try {

    let ecgCsv = null;


    const fileInput =
      form.ecg_file;


    if (
      fileInput &&
      fileInput.files &&
      fileInput.files.length > 0
    ) {

      const file =
        fileInput.files[0];


      ecgCsv =
        await readFileAsText(
          file
        );
    }


    // Temperature stays in Celsius.
    const temperatureC =
      parseFloat(
        form.temperature.value
      );


    const payload = {

      heart_rate:
        parseFloat(
          form.heart_rate.value
        ),


      spo2:
        parseFloat(
          form.spo2.value
        ),


      temperature:
        temperatureC,


      ecg_csv:
        ecgCsv,


      ecg_fs:
        250,


      source:
        "clinical"

    };


    const data =
      await apiFetch(
        "/api/check/clinical",
        {
          method: "POST",

          body:
            JSON.stringify(
              payload
            )
        }
      );

      // Keep a copy for compatibility, then render the complete screening
      // result directly below Run Fusion Analysis on this page.
      localStorage.setItem("screeningResult", JSON.stringify(data));
      renderInlineScreeningResult(data);
      return;


  } catch (err) {

    const errorMessage =
      err.message || "";


    const isFileFormatIssue =

      /clinical\/tabular CSV/i
        .test(errorMessage)

      ||

      /raw ECG signal/i
        .test(errorMessage)

      ||

      /wrong file format/i
        .test(errorMessage)

      ||

      /invalid.*ecg/i
        .test(errorMessage)

      ||

      /ecg.*invalid/i
        .test(errorMessage);


    if (
      isFileFormatIssue
    ) {

      hidePageError();

      showWrongFilePopup();


    } else {

      showError(
        errorMessage ||
        "Unable to analyze the ECG.",
        "Analysis Failed"
      );
    }


  } finally {

    btn.disabled = false;

    btn.textContent =
      "Run Fusion Analysis";
  }
}


// ============================================================
// INLINE SCREENING RESULTS (Hardware + Data Enter)
// ============================================================

let inlineEcgChart = null;

function inlineFirstAvailable(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function inlineNormalizeRisk(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).toLowerCase().trim();
  if (text.includes("high") || text.includes("severe")) return "High";
  if (text.includes("medium") || text.includes("moderate")) return "Medium";
  if (text.includes("low") || text.includes("normal")) return "Low";
  return null;
}

function inlineEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function inlineRiskPercent(level) {
  if (level === "Low") return 33;
  if (level === "Medium") return 66;
  if (level === "High") return 100;
  return 0;
}

function inlineRiskCard(title, risk, description) {
  const level = inlineNormalizeRisk(risk);
  const cls = level ? level.toLowerCase() : "unknown";
  const shown = level || "Not available";
  return `
    <div class="inline-risk-card ${cls}">
      <div class="inline-risk-title">${inlineEscapeHtml(title)}</div>
      <div class="inline-risk-level">${inlineEscapeHtml(shown)}</div>
      <div class="inline-risk-description">${inlineEscapeHtml(description)}</div>
      <div class="inline-risk-bar"><div class="inline-risk-bar-fill" style="width:${inlineRiskPercent(level)}%"></div></div>
    </div>`;
}

function inlineSensorCard(title, value, unit, subtitle) {
  const available = value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value));
  const shown = available ? Number(value) : "Not available";
  return `
    <div class="inline-result-card">
      <h3>${inlineEscapeHtml(title)}</h3>
      <div class="inline-card-subtitle">${inlineEscapeHtml(subtitle)}</div>
      <div class="inline-sensor-value">${inlineEscapeHtml(shown)}${available ? `<span>${inlineEscapeHtml(unit)}</span>` : ""}</div>
      <span class="inline-sensor-status ${available ? "available" : ""}">${available ? "Available" : "Not available"}</span>
    </div>`;
}

function inlineGetRecommendation(data, overall) {
  const backend = inlineFirstAvailable(data.recommendation, data.recommendation_text, data.guidance, data.message);
  if (backend) return String(backend);
  if (overall === "High") return "Seek prompt medical evaluation, especially if symptoms are present.";
  if (overall === "Medium") return "Arrange a clinical review and continue monitoring your vital signs.";
  if (overall === "Low") return "Continue routine monitoring and maintain healthy habits.";
  return "Review the screening result with a qualified healthcare professional.";
}

function inlineGetEcgSignal(data) {
  const signal = inlineFirstAvailable(
    data.ecg_signal, data.ecgSignal, data.ecg_waveform, data.ecgWaveform,
    data.signal, data.waveform,
    data.ecg && data.ecg.signal,
    data.ecg && data.ecg.waveform,
    data.ecg_result && data.ecg_result.signal,
    data.ecg_result && data.ecg_result.waveform
  );
  if (!Array.isArray(signal)) return [];
  return signal.map(Number).filter(Number.isFinite);
}

function renderInlineScreeningResult(data) {
  const box = document.getElementById("result-box");
  if (!box) return;

  const spo2 = inlineFirstAvailable(data.spo2, data.SpO2, data.spO2, data.spo2_value, data.spo2Value, data.vitals && data.vitals.spo2);
  const heartRate = inlineFirstAvailable(data.heart_rate, data.heartRate, data.hr, data.heart_rate_bpm, data.vitals && data.vitals.heart_rate);
  const temperature = inlineFirstAvailable(data.temperature, data.temp, data.body_temperature, data.temperature_c, data.vitals && data.vitals.temperature);

  const heartBlock = inlineFirstAvailable(data.heart_block_risk, data.heartBlockRisk, data.heart_block, data.heartBlock);
  const pulmonary = inlineFirstAvailable(data.pulmonary_hypertension_risk, data.pulmonaryHypertensionRisk, data.pulmonary_risk, data.pulmonaryRisk);
  const overall = inlineNormalizeRisk(inlineFirstAvailable(
    data.overall_screening_status, data.overall_status, data.overall_risk,
    data.screening_status, data.screeningStatus, data.final_risk, data.finalRisk
  ));
  const overallClass = overall ? overall.toLowerCase() : "unknown";
  const recommendation = inlineGetRecommendation(data, overall);

  // "Heart Risk Detected" is the fusion model's own Normal/Abnormal
  // verdict - the clearest yes/no answer to "is a heart risk
  // detected", separate from the Low/Medium/High screening bands
  // above (which also factor in simple vitals thresholds).
  const heartRiskDetected = data.result === "Abnormal";

  const remedyHtml = buildRemedyHtml(
    data.result,
    data.vitals_issues
  );

  box.innerHTML = `
    <section class="inline-screening-results">
      <div class="inline-results-heading">
        <h2>Screening Results</h2>
        <p>Multimodal ECG and available sensor data analysis.</p>
      </div>

      <div class="inline-heart-risk-banner ${heartRiskDetected ? "detected" : "clear"}">
        <span class="banner-icon">${heartRiskDetected ? "\u26a0\ufe0f" : "\u2705"}</span>
        <span>${heartRiskDetected ? "Heart Risk Detected" : "No Heart Risk Detected"}</span>
      </div>

      <div class="inline-analysis-notice">
        <strong>Multimodal Screening Analysis</strong>
        Only the parameters actually collected and returned by the screening system are displayed.
      </div>

      <div class="inline-results-grid">
        ${inlineSensorCard("SpO₂", spo2, "%", "Blood oxygen saturation")}
        ${inlineSensorCard("Heart Rate", heartRate, " bpm", "Beats per minute")}
        ${inlineSensorCard("Temperature", temperature, " °C", "Body temperature")}
      </div>

      <div class="inline-risk-grid">
        ${inlineRiskCard("Heart Block Risk", heartBlock, "Heart block screening estimate based on the available ECG and clinical data.")}
        ${inlineRiskCard("Pulmonary Hypertension Risk", pulmonary, "Pulmonary hypertension screening estimate based on the available ECG and clinical data.")}
        <div class="inline-overall-card ${overallClass}">
          <div class="inline-card-subtitle">Overall Screening Status</div>
          <div class="inline-overall-status">${inlineEscapeHtml(overall || "Not available")}</div>
          <span class="inline-overall-badge">${overall ? `${overall} screening status` : "Awaiting result"}</span>
        </div>
      </div>

      <div class="inline-results-bottom-grid">
        <div class="inline-result-card inline-ecg-card">
          <h3>ECG Waveform</h3>
          <div class="inline-card-subtitle">Loaded from the saved ECG capture (.dat) used for this analysis</div>
          <div class="inline-ecg-chart-wrap">
            <canvas id="inline-ecg-chart"></canvas>
            <div id="inline-ecg-empty" class="inline-ecg-empty">ECG waveform is not available in the returned result.</div>
          </div>
        </div>
        <div class="inline-result-card">
          <h3>Recommendation</h3>
          <div class="inline-card-subtitle">Screening guidance</div>
          <div class="inline-recommendation-box"><strong>Screening guidance</strong>${inlineEscapeHtml(recommendation)}</div>
          ${remedyHtml}
        </div>
      </div>

      <div class="inline-screening-footer">This is a screening estimate, not a medical diagnosis. Please consult a qualified healthcare professional for clinical interpretation.</div>
    </section>`;

  box.classList.add("has-inline-results");
  box.scrollIntoView({ behavior: "smooth", block: "start" });

  const signal = inlineGetEcgSignal(data);
  const canvas = document.getElementById("inline-ecg-chart");
  const empty = document.getElementById("inline-ecg-empty");
  if (inlineEcgChart) {
    inlineEcgChart.destroy();
    inlineEcgChart = null;
  }
  if (!signal.length || typeof Chart === "undefined") {
    if (canvas) canvas.style.display = "none";
    if (empty) empty.style.display = "flex";
    return;
  }
  canvas.style.display = "block";
  empty.style.display = "none";
  inlineEcgChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: signal.map((_, index) => index + 1),
      datasets: [{
        label: "ECG Signal",
        data: signal,
        borderColor: "#2f6fed",
        backgroundColor: "rgba(47,111,237,0.05)",
        borderWidth: 1.4,
        pointRadius: 0,
        fill: true,
        tension: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { grid: { color: "#e6eaf2" }, ticks: { color: "#6b7280" } } }
    }
  });
}

// ============================================================
// DASHBOARD HISTORY
// ============================================================

async function loadHistory() {

  const listEl =
    document.getElementById(
      "history-list"
    );


  if (!listEl) {
    return;
  }


  try {

    const records =
      await apiFetch(
        "/api/history"
      );


    if (
      records.length === 0
    ) {

      listEl.innerHTML = `

        <p
          style="color:#6b7280;"
        >
          No checks yet —
          run your first one above.
        </p>

      `;


      return;
    }


    listEl.innerHTML =
      records
        .map((r) => {


          const isHardware =
            r.check_type ===
            "hardware";


          // Use the exact screening status stored by the backend.
          // Do not derive High/Medium/Low from confidence.
          const riskLevel = String(
            r.overall_screening_status ||
            r.overall_status ||
            r.result ||
            "Not available"
          ).trim();

          const riskClass =
            ["low", "medium", "high"].includes(riskLevel.toLowerCase())
              ? riskLevel.toLowerCase()
              : "unknown";


          const icon =
            isHardware

              ? `

                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >

                  <path
                    d="M2 12h4l2-7 4 14 2-7h4l2 7 2-7"
                    stroke="#2f6fed"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />

                </svg>

              `

              : `

                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >

                  <path
                    d="M12 21s-7.5-4.6-10-9.3C.5 8.1 2.4 4.5 6 4c2-.3 3.6.7 6 3.2C14.4 4.7 16 3.7 18 4c3.6.5 5.5 4.1 4 7.7C19.5 16.4 12 21 12 21z"
                    stroke="#e0527a"
                    stroke-width="2"
                    stroke-linejoin="round"
                  />

                </svg>

              `;


          return `

            <div
              class="
                history-item
                ${riskClass}
              "
            >

              <div
                class="history-item-left"
              >

                <div
                  class="
                    history-icon
                    ${isHardware ? "hw" : "data"}
                  "
                >

                  ${icon}

                </div>


                <div>

                  <strong>

                    ${
                      isHardware

                        ? "Hardware Fusion Check"

                        : "ECG + Vitals Check"
                    }

                  </strong>


                  <div
                    class="history-date"
                  >

                    ${
                      new Date(
                        r.created_at
                      ).toLocaleString()
                    }

                  </div>

                </div>

              </div>


              <span
                class="tag ${riskClass}"
                style="
                  display:inline-flex;
                  align-items:center;
                  gap:7px;
                  color:${
                    riskLevel === "High"
                      ? "#dc2626"
                      : riskLevel === "Medium"
                        ? "#d97706"
                        : "#16a34a"
                  };
                  font-weight:700;
                "
              >

                <span
                  class="tag-dot"
                  style="
                    width:8px;
                    height:8px;
                    border-radius:50%;
                    display:inline-block;
                    background:${
                      riskLevel === "High"
                        ? "#dc2626"
                        : riskLevel === "Medium"
                          ? "#d97706"
                          : "#16a34a"
                    };
                  "
                ></span>

                Overall Screening Status: ${riskLevel}

              </span>

              <div class="history-screening-details">
                ${r.heart_block_risk ? `<span>Heart Block Risk: <strong>${r.heart_block_risk}</strong></span>` : ""}
                ${r.pulmonary_hypertension_risk ? `<span>Pulmonary Hypertension Risk: <strong>${r.pulmonary_hypertension_risk}</strong></span>` : ""}
              </div>

            </div>

          `;

        })

        .join("");


  } catch (err) {

    listEl.innerHTML = `

      <p
        style="color:#6b7280;"
      >

        Could not load history.

      </p>

    `;
  }
}