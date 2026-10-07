# Arduino Nano + AD8232 + HW-827 + DHT11

This sketch is integrated with the Vitals Flask application.

## Wiring

### AD8232 ECG module
- 3.3V/5V -> board supply pin (per module)
- GND -> GND
- OUTPUT -> A0
- LO+ -> D4
- LO- -> D5

### HW-827 pulse sensor
- VCC -> 5V
- GND -> GND
- AO -> A1

### DHT11
- VCC -> 5V
- GND -> GND
- DATA -> D2

## Arduino IDE

1. Install the **DHT sensor library** (Adafruit) from Library Manager.
2. Install the **PulseSensor Playground** library (search "PulseSensor
   Playground" in Library Manager) - the HW-827 pulse sensor is read
   through this library instead of a manual averaging loop, so BPM
   stays continuously up to date instead of only refreshing once a
   second.
3. Open `Vitals_Sensor/Vitals_Sensor.ino`.
4. Select **Arduino Nano** and the correct processor/COM port.
5. Upload the sketch.
6. Open Serial Monitor at **9600 baud** to verify readings.
7. Close Serial Monitor before connecting the Flask application,
   because only one program can use the COM port at a time.

## Modes

The sketch starts in **Health Data Mode**.

- Send `G` over serial to switch to **Graph Mode** - streams
  `ECG,LO_PLUS,LO_MINUS` once per loop for the Arduino Serial Plotter.
- Send `H` to return to **Health Data Mode**.

## Serial format (Health Data Mode)

About once a second, the sketch averages 10 raw ECG readings (HW-827
is serviced continuously via PulseSensorPlayground, not averaged),
reads the DHT11, then prints one block like:

```
====================================
           HEALTH READINGS
====================================
ECG Average (10): 512
HW-827 Raw: 530
Heart Rate BPM: 72
IBI: 810 ms
Temperature: 27.00 C
Humidity: 46.00 %
SpO2 (simulated): 91.00 %
LO+: 0
LO-: 0
ECG Leads: CONNECTED
HW-827 Status: HEART RATE DETECTED
====================================
```

The backend finds a reading by watching for the "====" lines that
open and close each block - whatever field lines land in between are
applied together, so a single failed DHT11 read or a heartbeat that
hasn't been detected yet never blocks the other sensors from
updating.

## ECG capture (`backend/ecg_captures/*.dat` and `*.xlsx`)

Clicking **Run Fusion Analysis** starts a real, on-demand 10-second
capture: the backend sends `G` to switch this sketch into Graph Mode,
which streams a **raw, unaveraged** `analogRead(ECG_PIN)` sample every
loop (no 10-reading smoothing) as fast as the serial link allows -
several hundred real points instead of 10 coarse averages. After 10
real seconds the backend sends `H` to put the sketch back into Health
Data Mode. The captured samples, and the real sample rate measured
from elapsed wall-clock time, are what get sent to the fusion model.
Every capture is written to `backend/ecg_captures/` as both a `.dat`
file and an `.xlsx` workbook (`Sample #`, `Time (s)`, `ECG Value`).
The waveform shown on the results page is the fusion model's processed
version of that same capture, not a separately-cached copy.

This capture only runs when you click **Run Fusion Analysis** - it is
not running in the background while just connected. Each click starts
a fresh 10-second capture; there is no live raw-ECG chart on the
Hardware tab itself, only the captured signal shown after running the
analysis.

SpO2 here is not a real blood-oxygen reading -- the sketch computes it
on the Arduino itself as `DHT11 humidity + 45`, capped at 100, because
the kit has no real SpO2 sensor. Heart Rate is the actual BPM detected
by PulseSensorPlayground (not capped in the sketch); the backend
separately flags a heart-rate average of 90+ (or under 60) as a
heart-risk reading, shown after Run Fusion Analysis.

The `====`/`----` lines and the `ECG Leads`/`HW-827 Status` lines are
decoration and are ignored by the backend parser. `Heart Rate BPM: 0`
is normal for the first few seconds after connecting, before the
first pulse has been detected -- the backend waits for a real
(positive) BPM before including it in the heart-rate average, without
that holding up Temperature, SpO2, or the ECG capture.
