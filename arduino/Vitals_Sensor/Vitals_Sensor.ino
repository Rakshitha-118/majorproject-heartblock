// =====================================================
// ECG VITALS FUSION - HARDWARE SKETCH
//
// AD8232 ECG MODULE + HW-827 PULSE SENSOR (via
// PulseSensorPlayground) + DHT11
//
// HEALTH DATA MODE (default) prints one block about once a
// second:
//
//   ECG Average (10)  : <0-1023>   <- one averaged ECG sample
//   HW-827 Raw        : <0-1023>
//   Heart Rate BPM    : <BPM>
//   IBI               : <ms>
//   Temperature       : <C>
//   Humidity          : <%>
//   SpO2 (simulated)  : <%>
//   LO+ / LO- / lead status / HW-827 status
//
// The backend reads these lines over the serial port for the
// live BPM/Temperature/SpO2 readouts. The real ECG waveform used
// for "Run Fusion Analysis" is captured separately: clicking that
// button makes the backend send 'G' (Graph Mode) for a real 10
// seconds, during which this sketch streams RAW, unaveraged
// analogRead(ECG_PIN) samples (see runGraphMode below) as fast
// as the serial link allows, then the backend sends 'H' to return
// to Health Data Mode. That's several hundred real points, not 10
// smoothed averages - saved to a .dat and .xlsx file on the
// backend for that one capture.
//
// HW-827 is no longer polled in a blocking 10-reading average.
// PulseSensorPlayground's serviceHW827() runs on every single
// loop() iteration (not gated by the 1-second timer), so BPM
// stays continuously up to date and a heartbeat is never missed
// while other sensors are being read.
//
// GRAPH MODE (send 'G') streams raw ECG,LO+,LO- - used both by
// the Arduino Serial Plotter and by the backend's real 10-second
// ECG capture above. Send 'H' to return to health data mode.
//
// Requires the "PulseSensor Playground" library
// (Library Manager -> search "PulseSensor Playground").
// =====================================================

#include <DHT.h>
#include <PulseSensorPlayground.h>

// =====================================================
// PIN DEFINITIONS
// =====================================================

#define DHT_PIN 2
#define DHT_TYPE DHT11

// ECG MODULE
#define ECG_PIN A0
#define LO_PLUS_PIN 4
#define LO_MINUS_PIN 5

// HW-827 HEART SENSOR
#define HW827_PIN A1

// BUILT-IN LED
#define LED_PIN 13

// =====================================================
// SETTINGS
// =====================================================

#define AVERAGE_READINGS 10

// Heartbeat warning limit
#define HEARTBEAT_LIMIT 90

// Same starting threshold used by your working
// HW-827 test code
#define HW827_THRESHOLD 550

// =====================================================
// OBJECTS
// =====================================================

DHT dht(DHT_PIN, DHT_TYPE);

PulseSensorPlayground pulseSensor;

// =====================================================
// VARIABLES
// =====================================================

bool graphMode = false;

float temperature = 0;
float humidity = 0;

int bpm = 0;
int ibi = 0;
int hw827Raw = 0;

bool hw827Started = false;

// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(9600);

  // -----------------------------------------
  // ECG
  // -----------------------------------------

  pinMode(LO_PLUS_PIN, INPUT);
  pinMode(LO_MINUS_PIN, INPUT);

  // -----------------------------------------
  // DHT11
  // -----------------------------------------

  dht.begin();

  // -----------------------------------------
  // HW-827
  // -----------------------------------------
  //
  // Same method as your working test code.
  // Only the pin is changed to A1.
  // -----------------------------------------

  pulseSensor.analogInput(HW827_PIN);

  pulseSensor.blinkOnPulse(LED_PIN);

  pulseSensor.setThreshold(HW827_THRESHOLD);

  hw827Started = pulseSensor.begin();

  delay(1000);

  Serial.println("====================================");
  Serial.println("       HEALTH MONITOR STARTED");
  Serial.println("====================================");

  if (hw827Started) {
    Serial.println("HW-827: READY");
  }
  else {
    Serial.println("HW-827: START ERROR");
  }

  Serial.println();

  Serial.println("CONNECTIONS:");
  Serial.println("DHT11 DATA -> D2");
  Serial.println("ECG OUT    -> A0");
  Serial.println("ECG LO+    -> D4");
  Serial.println("ECG LO-    -> D5");
  Serial.println("HW-827 SIG -> A1");

  Serial.println();

  Serial.println("Type G = ECG GRAPH MODE");
  Serial.println("Type H = HEALTH DATA MODE");
  Serial.println();

  delay(1000);
}

// =====================================================
// CONTINUOUS HW-827 SERVICE
// =====================================================
//
// IMPORTANT:
//
// This function is called continuously from loop().
//
// The HW-827 is NOT averaged every 2 seconds.
// The PulseSensorPlayground continuously monitors A1.
// =====================================================

void serviceHW827() {

  if (!hw827Started) {
    return;
  }

  // -----------------------------------------
  // Latest raw HW-827 signal
  // -----------------------------------------

  hw827Raw = pulseSensor.getLatestSample();

  // -----------------------------------------
  // Current BPM
  // -----------------------------------------

  int newBPM = pulseSensor.getBeatsPerMinute();

  if (newBPM > 0) {

    // Restrict displayed/stored BPM to a maximum of 90
    bpm = (newBPM > HEARTBEAT_LIMIT) ? HEARTBEAT_LIMIT : newBPM;
  }

  // -----------------------------------------
  // Detect heartbeat
  // -----------------------------------------

  if (pulseSensor.sawStartOfBeat()) {

    int detectedBPM = pulseSensor.getBeatsPerMinute();

    // Restrict detected BPM to a maximum of 90
    bpm = (detectedBPM > HEARTBEAT_LIMIT)
            ? HEARTBEAT_LIMIT
            : detectedBPM;

    ibi = pulseSensor.getInterBeatIntervalMs();

    Serial.println();
    Serial.println("*** HEARTBEAT DETECTED ***");

    Serial.print("BPM: ");
    Serial.println(bpm);

    Serial.print("IBI: ");
    Serial.print(ibi);
    Serial.println(" ms");

    Serial.print("HW-827 Raw: ");
    Serial.println(hw827Raw);

    Serial.println();
  }
}

// =====================================================
// ECG 10-READING AVERAGE
// =====================================================

int getAverageECG() {

  long total = 0;

  for (int i = 0; i < AVERAGE_READINGS; i++) {

    int sample = analogRead(ECG_PIN);

    total += sample;

    // Keep HW-827 active
    serviceHW827();

    delay(10);
  }

  return total / AVERAGE_READINGS;
}

// =====================================================
// DHT11 READING
// =====================================================

void readDHT11() {

  float newHumidity = dht.readHumidity();
  float newTemperature = dht.readTemperature();

  if (!isnan(newHumidity)) {
    humidity = newHumidity;
  }

  if (!isnan(newTemperature)) {
    temperature = newTemperature;
  }
}

// =====================================================
// GRAPH MODE
// =====================================================
//
// ECG GRAPH OUTPUT:
//
// ECG,LO_PLUS,LO_MINUS
//
// HW-827 is still continuously monitored,
// but is NOT included in the graph output.
// =====================================================

void runGraphMode() {

  // Raw, unaveraged ECG sample - this is what makes the 10-second
  // capture a real waveform instead of 10 smoothed points. Do NOT
  // call getAverageECG() here; that's the 10-reading/100ms-delay
  // average used only by Health Data Mode.

  int rawECG = analogRead(ECG_PIN);

  // Make sure HW-827 is updated
  serviceHW827();

  int loPlus = digitalRead(LO_PLUS_PIN);
  int loMinus = digitalRead(LO_MINUS_PIN);

  Serial.print(rawECG);
  Serial.print(",");

  Serial.print(loPlus);
  Serial.print(",");

  Serial.println(loMinus);
}

// =====================================================
// HEALTH DATA MODE
// =====================================================

void runHealthMode() {

  // -----------------------------------------
  // ECG
  // -----------------------------------------

  int averageECG = getAverageECG();

  // -----------------------------------------
  // DHT11
  // -----------------------------------------

  readDHT11();

  // -----------------------------------------
  // ECG LEADS
  // -----------------------------------------

  int loPlus = digitalRead(LO_PLUS_PIN);
  int loMinus = digitalRead(LO_MINUS_PIN);

  // -----------------------------------------
  // Keep HW-827 updated
  // -----------------------------------------

  serviceHW827();

  // -----------------------------------------
  // SIMULATED SpO2
  // -----------------------------------------
  //
  // This remains only because it existed
  // in your original project.
  // It is NOT a real SpO2 measurement.
  // -----------------------------------------

  int simulatedSpO2 = (int)humidity + 45;

  if (simulatedSpO2 > 100) {
    simulatedSpO2 = 100;
  }

  if (simulatedSpO2 < 0) {
    simulatedSpO2 = 0;
  }

  // =================================================
  // SERIAL MONITOR
  // =================================================

  Serial.println();
  Serial.println("====================================");
  Serial.println("           HEALTH READINGS");
  Serial.println("====================================");

  // -----------------------------------------
  // ECG
  // -----------------------------------------

  Serial.print("ECG Average (10): ");
  Serial.println(averageECG);

  // -----------------------------------------
  // HW-827 RAW VALUE
  // -----------------------------------------

  Serial.print("HW-827 Raw: ");
  Serial.println(hw827Raw);

  // -----------------------------------------
  // BPM
  // -----------------------------------------

  Serial.print("Heart Rate BPM: ");
  Serial.println(bpm);

  // -----------------------------------------
  // IBI
  // -----------------------------------------

  Serial.print("IBI: ");
  Serial.print(ibi);
  Serial.println(" ms");

  // -----------------------------------------
  // 90 BPM WARNING
  // -----------------------------------------

  if (bpm >= HEARTBEAT_LIMIT && bpm > 0) {

    Serial.println("HEARTBEAT LIMIT: 90 BPM");
  }

  // -----------------------------------------
  // DHT11
  // -----------------------------------------

  Serial.print("Temperature: ");
  Serial.print(temperature);
  Serial.println(" C");

  Serial.print("Humidity: ");
  Serial.print(humidity);
  Serial.println(" %");

  // -----------------------------------------
  // SIMULATED SpO2
  // -----------------------------------------

  Serial.print("SpO2 (simulated): ");
  Serial.print(simulatedSpO2);
  Serial.println(" %");

  // -----------------------------------------
  // ECG LEAD STATUS
  // -----------------------------------------

  Serial.print("LO+: ");
  Serial.println(loPlus);

  Serial.print("LO-: ");
  Serial.println(loMinus);

  if (loPlus == 0 && loMinus == 0) {

    Serial.println("ECG Leads: CONNECTED");
  }
  else {

    Serial.println("ECG Leads: CHECK ELECTRODES");
  }

  // -----------------------------------------
  // HW-827 STATUS
  // -----------------------------------------

  if (!hw827Started) {

    Serial.println("HW-827 Status: SENSOR ERROR");
  }
  else if (bpm > 0) {

    Serial.println("HW-827 Status: HEART RATE DETECTED");
  }
  else {

    Serial.println("HW-827 Status: WAITING FOR HEARTBEAT");
  }

  Serial.println("====================================");
}

// =====================================================
// LOOP
// =====================================================

void loop() {

  // =================================================
  // VERY IMPORTANT
  // =================================================
  //
  // Continuously process the HW-827.
  // Do NOT put this behind the 2-second timer.
  // =================================================

  serviceHW827();

  // =================================================
  // SERIAL COMMAND
  // =================================================

  if (Serial.available()) {

    char command = Serial.read();

    // -----------------------------------------------
    // GRAPH MODE
    // -----------------------------------------------

    if (command == 'G' || command == 'g') {

      graphMode = true;

      Serial.println("ECG,LO_PLUS,LO_MINUS");

      delay(200);
    }

    // -----------------------------------------------
    // HEALTH MODE
    // -----------------------------------------------

    if (command == 'H' || command == 'h') {

      graphMode = false;

      Serial.println();
      Serial.println("HEALTH DATA MODE");
      Serial.println();
    }
  }

  // =================================================
  // GRAPH MODE
  // =================================================

  if (graphMode) {

    runGraphMode();
  }

  // =================================================
  // HEALTH MODE
  // =================================================

  else {

    // Health information is displayed about once a second, so
    // the first 10 readings after connecting cover roughly 10
    // seconds of ECG signal. HW-827 itself continues running
    // continuously regardless of this timer.

    static unsigned long lastHealthTime = 0;

    if (millis() - lastHealthTime >= 1000) {

      lastHealthTime = millis();

      runHealthMode();
    }
  }

  delay(5);
}
