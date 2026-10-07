"""
Standalone serial test script for the Arduino Nano + HW-827 + DHT11 vitals kit.

This is a debug/sanity-check tool only - it just prints whatever the Arduino
sends. It does NOT talk to the FastAPI backend. For the actual app, run the
backend (`uvicorn app:app` inside backend/) and use the Hardware check page
in the browser, which parses this same sketch output (see SerialWorker in
backend/app.py).

Matches the current Vitals_Sensor.ino output format:
    Temperature : 27.00 C
    SpO2        : 91.00 %
    Heart Rate  : 72 BPM          (or "Waiting for heartbeat...")
    HEART STATUS: Heart Rate Normal

Usage:
    python test_serial.py            # auto-detect the Arduino's port
    python test_serial.py COM5       # or give the port explicitly
"""

import re
import sys
import time
from collections import deque

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    print("pyserial is not installed. Install it with:")
    print("    pip install pyserial")
    sys.exit(1)

BAUD_RATE = 9600

# Number of recent valid readings averaged together, same
# window used by the backend's Hardware check page.
AVERAGE_WINDOW = 5

TEMPERATURE_RE = re.compile(r"temperature\s*:\s*([\d.]+)", re.IGNORECASE)
SPO2_RE = re.compile(r"spo2\s*:\s*([\d.]+)", re.IGNORECASE)
HEART_RATE_RE = re.compile(r"heart\s*rate\s*:\s*([\d.]+)", re.IGNORECASE)
ERROR_RE = re.compile(r"(temperature|spo2)\s*:\s*error", re.IGNORECASE)


def find_arduino_port():
    """Try to auto-detect a likely Arduino Nano COM port."""
    ports = list(serial.tools.list_ports.comports())

    if not ports:
        return None

    # Prefer a port whose description mentions Arduino / CH340
    # (the common USB-serial chip on cheap Nano clones).
    for port in ports:
        desc = (port.description or "").lower()
        if "arduino" in desc or "ch340" in desc or "usb-serial" in desc:
            return port.device

    # Fall back to the first available port.
    return ports[0].device


def main():
    port = sys.argv[1] if len(sys.argv) > 1 else find_arduino_port()

    if not port:
        print("No serial ports found. Is the Arduino plugged in?")
        sys.exit(1)

    print("====================================")
    print(" Arduino Nano Vitals - Serial Test")
    print(f" Port: {port} @ {BAUD_RATE} baud")
    print("====================================")
    print("Close the Arduino IDE Serial Monitor first")
    print("(only one program can hold the COM port).")
    print()

    try:
        arduino = serial.Serial(port, BAUD_RATE, timeout=1)
    except serial.SerialException as e:
        print(f"Could not open {port}.")
        print(f"Error: {e}")
        sys.exit(1)

    # Give the Nano time to reset after the port opens.
    time.sleep(2)
    arduino.reset_input_buffer()

    block = {}
    window = deque(maxlen=AVERAGE_WINDOW)

    print("Listening... (Ctrl+C to stop)\n")

    try:
        while True:
            raw = arduino.readline().decode("utf-8", errors="ignore").strip()

            if not raw:
                continue

            # Header/footer decoration lines - just echo them.
            if raw.startswith("=") or raw.startswith("-") or raw.startswith("HEART STATUS"):
                print(raw)
                continue

            print(raw)

            if ERROR_RE.search(raw):
                # DHT11 read failed this cycle - skip, will retry next cycle.
                continue

            temp_match = TEMPERATURE_RE.search(raw)
            if temp_match:
                block["temperature"] = float(temp_match.group(1))

            spo2_match = SPO2_RE.search(raw)
            if spo2_match:
                block["spo2"] = float(spo2_match.group(1))

            hr_match = HEART_RATE_RE.search(raw)
            if hr_match:
                block["heart_rate"] = float(hr_match.group(1))

            if "temperature" in block and "spo2" in block:
                hr = block.get("heart_rate")
                hr_text = f"{hr:.0f} bpm" if hr is not None else "waiting for heartbeat"

                print(
                    f">> READING  Temp: {block['temperature']:.1f} C | "
                    f"SpO2: {block['spo2']:.1f} % | "
                    f"HR: {hr_text}"
                )

                # Only fold a reading into the rolling average once
                # a real heartbeat has been detected, same as the
                # backend - don't average in "waiting" cycles.
                if hr is not None:
                    window.append((hr, block["temperature"], block["spo2"]))

                    n = len(window)
                    avg_hr = sum(w[0] for w in window) / n
                    avg_temp = sum(w[1] for w in window) / n
                    avg_spo2 = sum(w[2] for w in window) / n

                    filling_note = (
                        f" (still filling: {n}/{AVERAGE_WINDOW})"
                        if n < AVERAGE_WINDOW
                        else ""
                    )

                    print(
                        f">> AVERAGE (last {n})  Temp: {avg_temp:.1f} C | "
                        f"SpO2: {avg_spo2:.1f} % | "
                        f"HR: {avg_hr:.0f} bpm{filling_note}\n"
                    )
                else:
                    print()

                block = {}

    except KeyboardInterrupt:
        print("\nStopping...")

    except Exception as e:
        print(f"Serial error: {e}")

    finally:
        arduino.close()


if __name__ == "__main__":
    main()
