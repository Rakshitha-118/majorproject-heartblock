# ECG Fusion — Heart Health Check App

A full web app around your trained ECG Fusion model:
- **Patient frontend**: register/login, then choose between a quick **Hardware vitals check**
  (SpO2, Heart Rate, Temperature — simple threshold logic) or a full **Clinical + ECG check**
  (22 clinical features + ECG signal, run through your trained fusion neural network).
- **Backend**: FastAPI + SQLite, loads your real `fusion_model.pt` and preprocessing tools.

## Project structure

```
ecg_app/
├── backend/              # Main API — auth, predictions, serves the frontend
│   ├── main.py           # FastAPI app & routes
│   ├── database.py       # SQLite models (User, Prediction)
│   ├── auth.py           # Password hashing + token auth
│   ├── inference.py      # Loads the trained model, runs predictions
│   ├── model_def.py      # Model architecture (copied from your notebook)
│   ├── preprocessing.py  # ECG signal preprocessing (copied from your notebook)
│   ├── schemas.py        # Request/response validation
│   └── model_artifacts/  # Your trained model + scaler/imputers (from Colab)
├── frontend/              # Static HTML/CSS/JS — white theme, animated
│   ├── index.html         # Landing page
│   ├── login.html / register.html
│   ├── dashboard.html     # 2 options: Hardware / Enter Data
│   ├── hardware.html      # SpO2 / Heart Rate / Temperature form (live from Arduino)
│   ├── enter-data.html    # Full 22-field clinical form + ECG CSV upload
│   ├── css/style.css
│   ├── js/app.js
│   └── js/hardware-serial.js  # Polls the backend serial connection, fills the hardware form
├── arduino/               # Arduino Nano sketch for the physical vitals kit (from the VITALS project)
│   └── Vitals_Sensor/Vitals_Sensor.ino
└── requirements.txt
```

## Setup

```bash
cd ecg_app
pip install -r requirements.txt
```

## Running

```bash
cd ecg_app/backend
uvicorn main:app --host 0.0.0.0 --port 8000
```
Open **http://localhost:8000** in your browser.

The SQLite database file (`ecg_app.db`) is created automatically at the project root
on first run.

## Notes on the model

- The "Enter Data" path uses your **actual trained Fusion model** (`fusion_model.pt`) —
  the same one from your notebook, loaded with the real weights, scaler, and imputers.
- The "Hardware" path (SpO2/HR/Temp) is **not** your trained model — it's simple,
  transparent threshold logic, since those 3 vitals were never part of the training data.
- ECG upload expects a plain CSV/text file of raw signal values (comma or newline
  separated), plus the sampling rate it was recorded at (default assumed: 250 Hz).
- If no ECG file is uploaded, the clinical check still runs using a neutral zero signal —
  the result leans more on the clinical branch in that case.

## Hardware (Arduino) integration

The "Live Vitals Check" page connects to the same Arduino Nano + HW-827 pulse
sensor + DHT11 kit used by the standalone VITALS project (sketch included
under `arduino/Vitals_Sensor/`), instead of the browser's Web Serial API.
The backend opens the serial port directly (see `backend/hardware_serial.py`)
and the page polls it once a second:

- **Heartbeat** → fills the **Heart Rate** field
- **Temperature** → fills the **Temperature** field
- **Humidity** → fills the **SpO2** field (the kit has no SpO2 sensor, so this
  slot is repurposed to surface the humidity reading; the value going into
  that field is humidity, not a real blood-oxygen reading)

Everything downstream — the "Run Check" button and the `/api/check/hardware`
threshold logic in `inference.py` — is unchanged. Note the existing threshold
check expects Temperature in °F; the sketch reports °C, so a live Temperature
reading will read low against that check unless you convert it.

Flash `arduino/Vitals_Sensor/Vitals_Sensor.ino` to the Nano, close the Arduino
IDE Serial Monitor (only one program can hold the COM port), then use
**Refresh ports → select the port → Connect device** on the Live Vitals Check
page. `pyserial` must be installed on the machine running the backend
(included in `requirements.txt`).

## Security notes before deploying anywhere public

- Change `APP_SECRET_KEY` (set as an environment variable) — currently using a
  placeholder default.
- This is a student/demo project — the 90% test accuracy was measured on a small
  held-out test set. Don't present this as a clinically validated diagnostic tool.
