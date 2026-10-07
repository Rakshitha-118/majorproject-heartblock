
#  ECG VITALS FUSION - COMPLETE SINGLE FILE BACKEND
# FastAPI + SQLite + Arduino + ECG + Fusion Model
 

import base64
import hashlib
import hmac
import json
import math
import os
import re
import ssl
import threading
import time
import urllib.parse
import urllib.request

from collections import deque
from datetime import datetime
from typing import Optional

import certifi
import joblib
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from fastapi import (
    Depends,
    FastAPI,
    Header,
    HTTPException,
)

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from itsdangerous import (
    BadSignature,
    SignatureExpired,
    URLSafeTimedSerializer,
)

from pydantic import BaseModel, EmailStr

from scipy.signal import (
    butter,
    filtfilt,
    iirnotch,
    resample,
)

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)

from sqlalchemy.orm import (
    Session,
    declarative_base,
    relationship,
    sessionmaker,
)


# ============================================================
# OPTIONAL ARDUINO SERIAL IMPORT
# ============================================================

try:
    import serial
    import serial.tools.list_ports

    SERIAL_AVAILABLE = True

except ImportError:
    serial = None
    SERIAL_AVAILABLE = False


# ============================================================
# OPTIONAL EXCEL (.xlsx) EXPORT
# ============================================================

try:
    from openpyxl import Workbook

    OPENPYXL_AVAILABLE = True

except ImportError:
    Workbook = None
    OPENPYXL_AVAILABLE = False


# ============================================================
# PROJECT PATHS
# ============================================================

BACKEND_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

PROJECT_DIR = os.path.dirname(
    BACKEND_DIR
)

FRONTEND_DIR = os.path.join(
    PROJECT_DIR,
    "frontend"
)

ARTIFACT_DIR = os.path.join(
    BACKEND_DIR,
    "model_artifacts"
)

DB_PATH = os.path.join(
    PROJECT_DIR,
    "ecg_app.db"
)


# ============================================================
# MODEL ARTIFACT FINDER
# ============================================================

def find_artifact(*names):

    for name in names:

        path = os.path.join(
            ARTIFACT_DIR,
            name
        )

        if os.path.exists(path):
            return path

    raise FileNotFoundError(
        "Missing model artifact. Expected one of: "
        + ", ".join(names)
    )


MODEL_PATH = find_artifact(
    "fusion_model.pth"
)

SCALER_PATH = find_artifact(
    "scaler.pkl"
)

IMPUTER_PATH = find_artifact(
    "imputer.pkl"
)


# ============================================================
# DATABASE
# ============================================================

Base = declarative_base()

DATABASE_URL = (
    f"sqlite:///{DB_PATH}"
)

engine = create_engine(
    DATABASE_URL,
    connect_args={
        "check_same_thread": False
    }
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)


# ============================================================
# USER TABLE
# ============================================================

class User(Base):

    __tablename__ = "users"

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    username = Column(
        String,
        unique=True,
        index=True,
        nullable=False
    )

    email = Column(
        String,
        unique=True,
        index=True,
        nullable=False
    )

    password_hash = Column(
        String,
        nullable=False
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )

    predictions = relationship(
        "Prediction",
        back_populates="user"
    )


# ============================================================
# PREDICTION HISTORY TABLE
# ============================================================

class Prediction(Base):

    __tablename__ = "predictions"

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False
    )

    check_type = Column(
        String,
        nullable=False
    )

    input_json = Column(
        Text,
        nullable=False
    )

    result = Column(
        String,
        nullable=False
    )

    confidence = Column(
        Float,
        nullable=True
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )

    user = relationship(
        "User",
        back_populates="predictions"
    )


Base.metadata.create_all(
    bind=engine
)


def get_db():

    db = SessionLocal()

    try:
        yield db

    finally:
        db.close()


# ============================================================
# AUTHENTICATION
# ============================================================

SECRET_KEY = os.environ.get(
    "APP_SECRET_KEY",
    "ecg-fusion-demo-secret-change-me"
)

serializer = URLSafeTimedSerializer(
    SECRET_KEY
)

TOKEN_MAX_AGE_SECONDS = (
    60 * 60 * 24 * 7
)


def hash_password(password: str):

    salt = os.urandom(16)

    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode(),
        salt,
        100_000
    )

    return base64.b64encode(
        salt + derived
    ).decode()


def verify_password(
    password: str,
    password_hash: str
):

    try:

        raw = base64.b64decode(
            password_hash.encode()
        )

        salt = raw[:16]
        stored_hash = raw[16:]

        calculated_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode(),
            salt,
            100_000
        )

        return hmac.compare_digest(
            calculated_hash,
            stored_hash
        )

    except Exception:
        return False


def create_token(user_id: int):

    return serializer.dumps({
        "user_id": user_id,
        "role": "user"
    })


def verify_token(token: str):

    try:

        return serializer.loads(
            token,
            max_age=TOKEN_MAX_AGE_SECONDS
        )

    except (
        BadSignature,
        SignatureExpired
    ):
        return None


# ============================================================
# API SCHEMAS
# ============================================================

class RegisterRequest(BaseModel):

    username: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):

    username: str
    password: str


class ClinicalCheckRequest(BaseModel):

    # New fusion model:
    # 1. Heart Rate
    # 2. Temperature in Celsius
    # 3. SpO2

    spo2: Optional[float] = None

    heart_rate: Optional[float] = None

    temperature: Optional[float] = None

    ecg_csv: Optional[str] = None

    ecg_fs: Optional[float] = 250

    source: Optional[str] = "clinical"


class HardwareConnectRequest(BaseModel):

    port: str

    baud: Optional[int] = 9600


# ============================================================
# SAVED ACTIVATION LAYER
# ============================================================

class LoggedActivation(nn.Module):

    def __init__(
        self,
        kind,
        feature_dim,
        rows=200
    ):

        super().__init__()

        self.kind = kind

        self.register_buffer(
            "x",
            torch.zeros(
                rows,
                feature_dim
            )
        )

        self.register_buffer(
            "y",
            torch.zeros(
                rows,
                feature_dim
            )
        )


    def forward(self, x):

        if self.kind == "tanh":

            return torch.tanh(x)

        if self.kind == "softmax":

            return torch.softmax(
                x,
                dim=1
            )

        if self.kind == "relu":

            return F.relu(x)

        return x


# ============================================================
# ECG BRANCH
# 1D CNN + BIDIRECTIONAL LSTM
# ============================================================

class ECGBranch(nn.Module):

    def __init__(self):

        super().__init__()

        self.cnn = nn.Sequential(

            nn.Conv1d(
                1,
                16,
                kernel_size=7,
                padding=3
            ),

            nn.BatchNorm1d(16),

            nn.ReLU(),

            nn.MaxPool1d(2),


            nn.Conv1d(
                16,
                32,
                kernel_size=5,
                padding=2
            ),

            nn.BatchNorm1d(32),

            nn.ReLU(),

            nn.MaxPool1d(2),


            nn.Conv1d(
                32,
                64,
                kernel_size=3,
                padding=1
            ),

            nn.BatchNorm1d(64),

            nn.ReLU(),

            nn.MaxPool1d(2),
        )

        self.lstm = nn.LSTM(
            input_size=64,
            hidden_size=64,
            batch_first=True,
            bidirectional=True
        )

        self.proj = nn.Linear(
            128,
            128
        )


    def forward(self, x):

        x = self.cnn(x)

        x = x.permute(
            0,
            2,
            1
        )

        x, _ = self.lstm(x)

        x = x.mean(
            dim=1
        )

        x = self.proj(x)

        return x


# ============================================================
# CLINICAL / VITALS BRANCH
# ============================================================

class ClinicalBranch(nn.Module):

    def __init__(self):

        super().__init__()

        self.feature_attn = nn.Sequential(

            nn.Linear(
                3,
                16
            ),

            LoggedActivation(
                "tanh",
                16
            ),

            nn.Linear(
                16,
                3
            ),

            LoggedActivation(
                "softmax",
                3
            ),
        )

        self.mlp = nn.Sequential(

            nn.Linear(
                3,
                32
            ),

            LoggedActivation(
                "relu",
                32
            ),

            nn.Linear(
                32,
                64
            ),

            LoggedActivation(
                "relu",
                64
            ),

            nn.Linear(
                64,
                128
            ),
        )


    def forward(self, x):

        attention = self.feature_attn(x)

        weighted = (
            x * attention
        )

        return self.mlp(
            weighted
        )


# ============================================================
# CROSS ATTENTION
# ============================================================

class CrossAttention(nn.Module):

    def __init__(
        self,
        dim=128
    ):

        super().__init__()

        self.q_ecg = nn.Linear(
            dim,
            dim
        )

        self.k_clin = nn.Linear(
            dim,
            dim
        )

        self.v_clin = nn.Linear(
            dim,
            dim
        )

        self.q_clin = nn.Linear(
            dim,
            dim
        )

        self.k_ecg = nn.Linear(
            dim,
            dim
        )

        self.v_ecg = nn.Linear(
            dim,
            dim
        )

        self.scale = math.sqrt(
            dim
        )


    def forward(
        self,
        ecg_features,
        clinical_features
    ):

        ecg_scores = (

            self.q_ecg(
                ecg_features
            )

            *

            self.k_clin(
                clinical_features
            )

        ) / self.scale


        ecg_attention = torch.softmax(
            ecg_scores,
            dim=1
        )


        clinical_scores = (

            self.q_clin(
                clinical_features
            )

            *

            self.k_ecg(
                ecg_features
            )

        ) / self.scale


        clinical_attention = torch.softmax(
            clinical_scores,
            dim=1
        )


        ecg_output = (

            ecg_features

            +

            ecg_attention
            *
            self.v_clin(
                clinical_features
            )
        )


        clinical_output = (

            clinical_features

            +

            clinical_attention
            *
            self.v_ecg(
                ecg_features
            )
        )


        return (
            ecg_output,
            clinical_output
        )


# ============================================================
# EVIDENTIAL HEAD
# ============================================================

class EvidentialHead(nn.Module):

    def __init__(self):

        super().__init__()

        self.fc = nn.Linear(
            128,
            2
        )


    def forward(self, x):

        evidence = F.softplus(
            self.fc(x)
        )

        alpha = (
            evidence + 1
        )

        strength = alpha.sum(
            dim=1,
            keepdim=True
        )

        probabilities = (
            alpha / strength
        )

        uncertainty = (
            2.0 / strength
        ).squeeze(1)

        return (
            probabilities,
            uncertainty
        )


# ============================================================
# COMPLETE FUSION MODEL
# ============================================================

class FusionModel(nn.Module):

    def __init__(self):

        super().__init__()

        self.ecg_branch = ECGBranch()

        self.clin_branch = ClinicalBranch()

        self.cross_attn = CrossAttention(
            128
        )

        self.ecg_head = EvidentialHead()

        self.clin_head = EvidentialHead()

        self.fusion_fc = nn.Sequential(

            nn.Linear(
                256,
                128
            ),

            nn.ReLU(),

            nn.Dropout(
                0.3
            ),

            nn.Linear(
                128,
                1
            ),
        )


    def forward(
        self,
        ecg,
        clinical
    ):

        ecg_features = (
            self.ecg_branch(
                ecg
            )
        )

        clinical_features = (
            self.clin_branch(
                clinical
            )
        )

        (
            ecg_features,
            clinical_features

        ) = self.cross_attn(

            ecg_features,
            clinical_features
        )

        (
            ecg_probability,
            ecg_uncertainty

        ) = self.ecg_head(
            ecg_features
        )

        (
            clinical_probability,
            clinical_uncertainty

        ) = self.clin_head(
            clinical_features
        )


        inverse_ecg = (

            1.0

            /

            (
                ecg_uncertainty
                +
                1e-6
            )
        )


        inverse_clinical = (

            1.0

            /

            (
                clinical_uncertainty
                +
                1e-6
            )
        )


        total = (
            inverse_ecg
            +
            inverse_clinical
        )


        weight_ecg = (
            inverse_ecg
            /
            total
        )


        weight_clinical = (
            inverse_clinical
            /
            total
        )


        fused = torch.cat(

            [

                ecg_features
                *
                weight_ecg.unsqueeze(1),

                clinical_features
                *
                weight_clinical.unsqueeze(1)

            ],

            dim=1
        )


        logit = self.fusion_fc(
            fused
        ).squeeze(1)


        probability_abnormal = (
            torch.sigmoid(
                logit
            )
        )


        agreement = (

            1

            -

            0.5

            *

            (
                ecg_probability
                -
                clinical_probability

            ).abs().sum(
                dim=1
            )
        )


        return {

            "logit":
                logit,

            "prob_abnormal":
                probability_abnormal,

            "prob_ecg":
                ecg_probability,

            "prob_clin":
                clinical_probability,

            "uncertainty_ecg":
                ecg_uncertainty,

            "uncertainty_clin":
                clinical_uncertainty,

            "weight_ecg":
                weight_ecg,

            "weight_clin":
                weight_clinical,

            "agreement":
                agreement,
        }


# ============================================================
# LOAD NEW IMPUTER
# ============================================================

imputer = joblib.load(
    IMPUTER_PATH
)


# ============================================================
# LOAD NEW SCALER
# ============================================================

scaler = joblib.load(
    SCALER_PATH
)


if (
    getattr(
        imputer,
        "n_features_in_",
        None
    )
    !=
    3
):

    raise RuntimeError(
        "imputer.pkl must contain exactly 3 features."
    )


if (
    getattr(
        scaler,
        "n_features_in_",
        None
    )
    !=
    3
):

    raise RuntimeError(
        "scaler.pkl must contain exactly 3 features."
    )


# ============================================================
# DEVICE
# ============================================================

DEVICE = torch.device(

    "cuda"

    if torch.cuda.is_available()

    else "cpu"
)


# ============================================================
# LOAD NEW MODEL
# ============================================================

model = FusionModel().to(
    DEVICE
)

state_dict = torch.load(
    MODEL_PATH,
    map_location=DEVICE,
    weights_only=True
)

model.load_state_dict(
    state_dict,
    strict=True
)

model.eval()


print(
    "[MODEL] Loaded:",
    MODEL_PATH
)

print(
    "[MODEL] Device:",
    DEVICE
)


# ============================================================
# ECG PREPROCESSING SETTINGS
# ============================================================

TARGET_FS = 100

WIN_SEC = 10

WIN_LEN = (
    TARGET_FS
    *
    WIN_SEC
)


# ============================================================
# R-PEAK CENTERED WINDOW
# ============================================================

def rpeak_centered_window(
    sig,
    fs,
    win_len=WIN_LEN,
    target_fs=TARGET_FS
):

    try:

        import neurokit2 as nk

        _, info = nk.ecg_peaks(
            sig,
            sampling_rate=fs
        )

        rpeaks = info[
            "ECG_R_Peaks"
        ]

    except Exception:

        rpeaks = np.array([])


    win_sec = (
        win_len
        /
        target_fs
    )


    half = int(
        win_sec
        *
        fs
        /
        2
    )


    if len(rpeaks) > 0:

        center = int(
            rpeaks[
                len(rpeaks) // 2
            ]
        )

    else:

        center = int(
            win_sec
            *
            fs
            /
            2
        )


    start = max(
        0,
        center - half
    )


    end = (

        start

        +

        int(
            win_sec
            *
            fs
        )
    )


    if end > len(sig):

        end = len(sig)

        start = max(

            0,

            end
            -
            int(
                win_sec
                *
                fs
            )
        )


    segment = sig[
        start:end
    ]


    if len(segment) < 10:

        raise ValueError(
            "ECG signal is too short."
        )


    return resample(
        segment,
        win_len
    )


# ============================================================
# BANDPASS FILTER
# ============================================================

def bandpass_filter(
    sig,
    fs=TARGET_FS,
    low=0.5,
    high=40.0,
    order=4
):

    nyquist = (
        0.5
        *
        fs
    )

    high = min(
        high,
        nyquist - 1
    )

    b, a = butter(

        order,

        [
            low / nyquist,
            high / nyquist
        ],

        btype="band"
    )

    return filtfilt(
        b,
        a,
        sig
    )


# ============================================================
# NOTCH FILTER
# ============================================================

def notch_filter(
    sig,
    fs=TARGET_FS,
    freq=50,
    q=30
):

    nyquist = (
        0.5
        *
        fs
    )

    if freq >= nyquist:

        return sig

    b, a = iirnotch(
        freq / nyquist,
        q
    )

    return filtfilt(
        b,
        a,
        sig
    )


# ============================================================
# Z-SCORE NORMALIZATION
# ============================================================

def zscore(sig):

    mean = sig.mean()

    std = sig.std()

    if std <= 1e-8:

        std = 1e-8

    return (
        sig - mean
    ) / std


# ============================================================
# COMPLETE ECG PREPROCESSING
# ============================================================

def preprocess_raw_ecg(
    sig,
    fs
):

    sig = np.asarray(
        sig,
        dtype=np.float64
    )

    windowed = (
        rpeak_centered_window(
            sig,
            fs
        )
    )

    filtered = (
        bandpass_filter(
            windowed
        )
    )

    filtered = (
        notch_filter(
            filtered
        )
    )

    normalized = (
        zscore(
            filtered
        )
    )

    return normalized.astype(
        np.float32
    )


# ============================================================
# RAW ECG FILE PARSER
# ============================================================

def parse_ecg_signal(text):

    if (
        not text
        or
        not text.strip()
    ):

        raise ValueError(
            "The uploaded ECG file is empty."
        )


    lines = [

        line.strip()

        for line
        in text.splitlines()

        if line.strip()
    ]


    def tokens(line):

        return [

            value.strip()

            for value
            in line.split(",")

            if value.strip()
        ]


    def is_float(value):

        try:

            float(value)

            return True

        except ValueError:

            return False


    body = lines


    # Remove possible text header.

    if any(

        not is_float(value)

        for value
        in tokens(lines[0])

    ):

        body = lines[1:]


    if not body:

        raise ValueError(

            "This looks like clinical/tabular data, "
            "not a raw ECG signal."
        )


    token_counts = [

        len(
            tokens(line)
        )

        for line
        in body
    ]


    multi_column_rows = sum(

        1

        for count
        in token_counts

        if count > 1
    )


    if (
        len(body) > 1
        and
        multi_column_rows > 1
    ):

        raise ValueError(

            "This looks like a clinical/tabular CSV, "
            "not a raw ECG signal. "
            "Upload raw ECG values only."
        )


    try:

        values = np.asarray(

            [

                float(value)

                for line
                in body

                for value
                in tokens(line)
            ],

            dtype=np.float64
        )

    except ValueError as error:

        raise ValueError(

            "Invalid ECG file. "
            "Upload numeric raw ECG values only."

        ) from error


    if values.size < 10:

        raise ValueError(
            "The ECG signal contains too few samples."
        )


    if not np.all(
        np.isfinite(values)
    ):

        raise ValueError(
            "The ECG file contains invalid values."
        )


    return values


# ============================================================
# BUILD NEW 3-FEATURE VITAL VECTOR
#
# ORDER:
# 1. Heart Rate
# 2. Temperature Celsius
# 3. SpO2
# ============================================================

def build_clinical_vector(
    payload
):

    values = np.array(

        [[

            # HEART RATE
            np.nan
            if payload.get(
                "heart_rate"
            ) is None
            else float(
                payload[
                    "heart_rate"
                ]
            ),


            # TEMPERATURE CELSIUS
            np.nan
            if payload.get(
                "temperature"
            ) is None
            else float(
                payload[
                    "temperature"
                ]
            ),


            # SpO2
            np.nan
            if payload.get(
                "spo2"
            ) is None
            else float(
                payload[
                    "spo2"
                ]
            )

        ]],

        dtype=np.float64
    )


    # ========================================================
    # IMPUTER
    # ========================================================

    statistics = np.asarray(

        imputer.statistics_,

        dtype=np.float64

    ).reshape(
        1,
        -1
    )


    values = np.where(

        np.isnan(values),

        statistics,

        values
    )


    # ========================================================
    # STANDARD SCALER
    # ========================================================

    scaler_mean = np.asarray(

        scaler.mean_,

        dtype=np.float64

    ).reshape(
        1,
        -1
    )


    scaler_scale = np.asarray(

        scaler.scale_,

        dtype=np.float64

    ).reshape(
        1,
        -1
    )


    scaler_scale = np.where(

        np.abs(
            scaler_scale
        ) < 1e-12,

        1.0,

        scaler_scale
    )


    values = (

        values
        -
        scaler_mean

    ) / scaler_scale


    return values.astype(
        np.float32
    )


# ============================================================
# VITAL THRESHOLD CHECK
# CELSIUS
# ============================================================

def hardware_thresholds(
    spo2,
    heart_rate,
    temperature_c
):

    issues = []


    # --------------------------------------------------------
    # SpO2
    # --------------------------------------------------------

    if (
        spo2 is not None
        and
        float(spo2) < 94
    ):

        issues.append(
            "Low SpO2"
        )


    # --------------------------------------------------------
    # HEART RATE
    # --------------------------------------------------------

    if heart_rate is not None:

        heart_rate = float(
            heart_rate
        )

        if (
            heart_rate < 60
            or
            heart_rate > 100
        ):

            issues.append(
                "Heart rate out of normal resting range"
            )


    # --------------------------------------------------------
    # TEMPERATURE CELSIUS
    # --------------------------------------------------------

    if temperature_c is not None:

        temperature_c = float(
            temperature_c
        )


        if temperature_c > 38.0:

            issues.append(
                "Fever"
            )


        elif temperature_c < 35.0:

            issues.append(
                "Low body temperature"
            )


    return issues


# ============================================================
# SOFTWARE (MANUAL ENTRY) SEVERITY - LOW / MEDIUM / HIGH
# ============================================================
# Used only for source == "clinical" (the manual-entry / Enter
# Data page). The hardware path below keeps its original
# Medium/Low-only behavior unchanged.
# ============================================================

def software_thresholds(
    spo2,
    heart_rate,
    temperature_c
):
    """Clinical/manual-entry vital ranges. Hardware thresholds remain unchanged."""
    issues = []

    if spo2 is not None:
        spo2 = float(spo2)
        if spo2 < 90:
            issues.append("Low SpO2")
        elif spo2 < 95:
            issues.append("Low SpO2")

    if heart_rate is not None:
        heart_rate = float(heart_rate)
        if heart_rate < 50 or heart_rate > 120:
            issues.append("Heart rate out of normal resting range")
        elif heart_rate < 60 or heart_rate > 100:
            issues.append("Heart rate out of normal resting range")

    if temperature_c is not None:
        temperature_c = float(temperature_c)
        if temperature_c < 35.0 or temperature_c >= 38.0:
            issues.append("Temperature outside normal range")
        elif temperature_c < 36.0 or temperature_c > 37.5:
            issues.append("Temperature outside normal range")

    return issues


def classify_software_severity(
    predicted_abnormal,
    abnormal_probability,
    spo2,
    heart_rate,
    temperature_c,
    issues
):

    high = False
    medium = False

    # ECG model verdict
    if predicted_abnormal:
        if (
            abnormal_probability is not None
            and abnormal_probability >= 0.75
        ):
            high = True
        else:
            medium = True

    # SpO2
    if spo2 is not None:
        spo2 = float(spo2)
        if spo2 < 90:
            high = True
        elif spo2 < 95:
            medium = True

    # Heart rate
    if heart_rate is not None:
        heart_rate = float(heart_rate)
        if heart_rate < 50 or heart_rate > 120:
            high = True
        elif heart_rate < 60 or heart_rate > 100:
            medium = True

    # Temperature (Celsius)
    if temperature_c is not None:
        temperature_c = float(temperature_c)
        if temperature_c >= 38.0 or temperature_c < 35.0:
            high = True
        elif temperature_c > 37.5 or temperature_c < 36.0:
            medium = True

    # Multiple simultaneous vitals issues escalate the tier
    if issues and len(issues) >= 2:
        high = True
    elif issues:
        medium = True

    if high:
        return "High"

    if medium:
        return "Medium"

    return "Low"


def software_branch_risk(
    predicted_abnormal,
    abnormal_probability,
    spo2
):
    """heart_block_risk / pulmonary_hypertension_risk for source == 'clinical'."""

    if predicted_abnormal:
        heart_block = (
            "High"
            if abnormal_probability is not None
            and abnormal_probability >= 0.75
            else "Medium"
        )
    else:
        heart_block = "Low"

    if spo2 is not None:
        spo2 = float(spo2)
        if spo2 < 90:
            pulmonary = "High"
        elif spo2 < 95:
            pulmonary = "Medium"
        else:
            pulmonary = "Low"
    else:
        pulmonary = "Low"

    return heart_block, pulmonary


# ============================================================
# FUSION MODEL PREDICTION
# ============================================================
#
# source == "hardware": screens and reports Medium/Low only -
# no "High" tier, since the hardware sensor pipeline (a hobby
# AD8232/HW-827 rig) isn't validated enough to claim "High risk".
#
# source == "clinical" (manual entry): full Low/Medium/High
# tiering, restored to its original behavior.
# ============================================================

def predict_fusion(
    payload,
    ecg_csv_text=None,
    ecg_fs=250,
    source="clinical"
):

    # --------------------------------------------------------
    # VITALS INPUT
    # --------------------------------------------------------

    clinical_array = (
        build_clinical_vector(
            payload
        )
    )


    clinical_tensor = torch.tensor(

        clinical_array,

        dtype=torch.float32,

        device=DEVICE
    )


    # --------------------------------------------------------
    # ECG INPUT
    # --------------------------------------------------------

    if ecg_csv_text:

        raw_ecg = (
            parse_ecg_signal(
                ecg_csv_text
            )
        )


        processed_ecg = (
            preprocess_raw_ecg(

                raw_ecg,

                fs=float(
                    ecg_fs
                    or
                    250
                )
            )
        )


        ecg_tensor = torch.tensor(

            processed_ecg,

            dtype=torch.float32,

            device=DEVICE

        ).view(
            1,
            1,
            -1
        )


        ecg_provided = True


    else:

        ecg_tensor = torch.zeros(

            (
                1,
                1,
                WIN_LEN
            ),

            dtype=torch.float32,

            device=DEVICE
        )


        ecg_provided = False


    # --------------------------------------------------------
    # RUN MODEL
    # --------------------------------------------------------

    with torch.no_grad():

        output = model(
            ecg_tensor,
            clinical_tensor
        )


        abnormal_probability = float(

            output[
                "prob_abnormal"
            ][0].item()
        )


        predicted_abnormal = (

            abnormal_probability
            >=
            0.5
        )


        if predicted_abnormal:

            confidence = (
                abnormal_probability
            )

        else:

            confidence = (
                1.0
                -
                abnormal_probability
            )


        ecg_probability = float(

            output[
                "prob_ecg"
            ][0, 1].item()
        )


        clinical_probability = float(

            output[
                "prob_clin"
            ][0, 1].item()
        )


        if ecg_provided:

            ecg_abnormal = (

                ecg_probability
                >=
                0.5
            )

        else:

            ecg_abnormal = None


        if source == "hardware":
            # Hardware thresholds are intentionally unchanged.
            issues = hardware_thresholds(
                payload.get("spo2"),
                payload.get("heart_rate"),
                payload.get("temperature")
            )
        else:
            # Enter Data / software uses the clinical ranges above.
            issues = software_thresholds(
                payload.get("spo2"),
                payload.get("heart_rate"),
                payload.get("temperature")
            )


        # ----------------------------------------------------
        # SEVERITY - branches by source. Hardware keeps its
        # original Medium/Low-only behavior; manual entry
        # ("clinical") gets full Low/Medium/High tiering.
        # ----------------------------------------------------

        is_hardware = (source == "hardware")

        if is_hardware:

            heart_block_risk = (
                "Medium"
                if predicted_abnormal
                else "Low"
            )

            pulmonary_hypertension_risk = (
                "Medium"
                if payload.get("spo2") is not None
                and payload.get("spo2") < 94
                else "Low"
            )

            overall_severity = (
                "Medium"
                if predicted_abnormal
                or (payload.get("spo2") is not None and payload.get("spo2") < 94)
                or bool(issues)
                else "Low"
            )

            recommendation_text = (
                "Arrange a clinical review and continue monitoring your vital signs."
                if predicted_abnormal or bool(issues)
                else "Continue routine monitoring and maintain healthy habits."
            )

        else:

            heart_block_risk, pulmonary_hypertension_risk = (
                software_branch_risk(
                    predicted_abnormal,
                    abnormal_probability,
                    payload.get("spo2")
                )
            )

            overall_severity = classify_software_severity(
                predicted_abnormal,
                abnormal_probability,
                payload.get("spo2"),
                payload.get("heart_rate"),
                payload.get("temperature"),
                issues
            )

            if overall_severity == "High":
                recommendation_text = (
                    "Seek prompt medical attention and arrange a "
                    "clinical review as soon as possible."
                )
            elif overall_severity == "Medium":
                recommendation_text = (
                    "Arrange a clinical review and continue "
                    "monitoring your vital signs."
                )
            else:
                recommendation_text = (
                    "Continue routine monitoring and maintain "
                    "healthy habits."
                )


        return {

            "result":
                "Abnormal"
                if predicted_abnormal
                else "Normal",


            "confidence":
                round(
                    confidence * 100,
                    2
                ),


            "abnormal_probability":
                round(
                    abnormal_probability
                    *
                    100,
                    2
                ),


            "agreement":
                round(

                    float(
                        output[
                            "agreement"
                        ][0].item()
                    )
                    *
                    100,

                    2
                ),


            "ecg_provided":
                ecg_provided,


            "ecg_abnormal":
                ecg_abnormal,


            "vitals_issues":
                issues,


            "spo2":
                payload.get("spo2"),


            "heart_rate":
                payload.get("heart_rate"),


            "temperature":
                payload.get("temperature"),


            "heart_block_risk":
                heart_block_risk,


            "pulmonary_hypertension_risk":
                pulmonary_hypertension_risk,


            "overall_status":
                overall_severity,


            "overall_screening_status":
                overall_severity,


            "recommendation":
                recommendation_text,


            "ecg_signal":
                processed_ecg.tolist()
                if ecg_provided
                else [],


            "vitals_abnormal":
                bool(
                    issues
                ),


            "branch_detail": {

                "ecg_prob_abnormal":
                    round(
                        ecg_probability
                        *
                        100,
                        2
                    ),


                "clinical_prob_abnormal":
                    round(
                        clinical_probability
                        *
                        100,
                        2
                    ),


                "ecg_uncertainty":
                    round(

                        float(
                            output[
                                "uncertainty_ecg"
                            ][0].item()
                        ),

                        4
                    ),


                "clinical_uncertainty":
                    round(

                        float(
                            output[
                                "uncertainty_clin"
                            ][0].item()
                        ),

                        4
                    ),


                "ecg_weight":
                    round(

                        float(
                            output[
                                "weight_ecg"
                            ][0].item()
                        )
                        *
                        100,

                        2
                    ),


                "clinical_weight":
                    round(

                        float(
                            output[
                                "weight_clin"
                            ][0].item()
                        )
                        *
                        100,

                        2
                    )
            }
        }


# ============================================================
# HARDWARE LOGIC
# ============================================================
#
# REAL SENSOR VALUES - NO RANDOM VALUES
#
# HW-827:
#   Heartbeat -> Heart Rate
#
# DHT11:
#   Temperature -> Temperature °C
#   Humidity    -> SpO2 field for PROJECT/DEMO ONLY
#
# IMPORTANT:
# DHT11 humidity is not a real blood-oxygen measurement.
# It is mapped directly to the SpO2 field only because the
# current hardware does not include a real SpO2 sensor.
#
# Heart-rate behavior:
# - A positive BPM from Arduino is used exactly as received.
# - A 0/negative BPM is NOT replaced with a random value.
# - Invalid 0 BPM readings are ignored, so the page waits for
#   a real pulse reading instead of displaying a fake BPM.
# ============================================================


# ============================================================
# HARDWARE REGEX
# ============================================================

#   "Heart Rate: 72"            "Heart Rate BPM: 72"
# but never "HEARTBEAT LIMIT: 90 BPM" (that's a status line, not
# a reading - the (?!\s*limit) lookahead excludes it).
HEARTBEAT_RE = re.compile(
    r"heart\s*(?:beat|rate)(?!\s*limit)[^:\r\n]*:\s*(-?[\d.]+)",
    re.IGNORECASE
)

TEMPERATURE_RE = re.compile(
    r"temp(?:erature)?\s*[:\s]+([\d.]+)",
    re.IGNORECASE
)

HUMIDITY_RE = re.compile(
    r"humid(?:ity)?\s*[:\s]+([\d.]+)",
    re.IGNORECASE
)

# Some sketches compute SpO2 on the Arduino itself (e.g. humidity + a
# fixed offset) and print it as its own line instead of, or alongside,
# a raw Humidity line - allowing for extra wording such as
# "SpO2 (simulated): 91" between the label and the colon.
SPO2_RE = re.compile(
    r"spo2[^:\r\n]*:\s*(-?[\d.]+)",
    re.IGNORECASE
)

DHT_ERROR_RE = re.compile(
    r"(temp(?:erature)?|humid(?:ity)?|spo2)\s*:\s*error|dht11 reading failed",
    re.IGNORECASE
)

# Averaged ECG sample printed by the sketch, e.g.
#   "ECG Avg (10) : 512"      or      "ECG Average (10): 512"
# Lines such as "ECG Leads: CONNECTED" never match because the
# value after the colon is not numeric.
ECG_RE = re.compile(
    r"ecg[^:\r\n]*:\s*(-?[\d.]+)\s*$",
    re.IGNORECASE
)

# One health-data reading is one block between these two markers:
#   ========== HEALTH DATA ==========
#   ... field lines ...
#   =================================
# Parsing block-by-block (instead of requiring every field to show
# up in a fixed order on one pass) means a slow/missing DHT11 or
# HW-827 reading in a given cycle no longer blocks the other
# sensors from updating.
BLOCK_START_RE = re.compile(
    r"=+\s*health\s*data\s*=+",
    re.IGNORECASE
)

BLOCK_END_RE = re.compile(
    r"^=+$"
)


# ============================================================
# SENSOR VALUE HELPERS
# ============================================================

def display_heartbeat(heartbeat):
    """Return the actual positive heartbeat value from Arduino."""
    heartbeat = float(heartbeat)

    if heartbeat <= 0:
        return None

    return round(heartbeat, 1)


def temperature_reading_celsius(sensor_temperature_c):
    """Use the DHT11 Celsius value directly, with no calibration."""
    return round(float(sensor_temperature_c), 1)


def spo2_from_humidity_demo(humidity):
    """
    Project/demo mapping only:
    DHT11 humidity is copied directly into the SpO2 field.
    No offset and no random value are added.
    """
    return round(float(humidity), 1)


# ============================================================
# REAL 10-SECOND RAW ECG CAPTURE (.dat + .xlsx)
# ============================================================
#
# Triggered on demand (when "Run Fusion Analysis" is clicked),
# not run automatically in the background. When started, the
# backend sends 'G' to switch the sketch into Graph Mode, which
# streams one *unaveraged* analogRead(ECG_PIN) sample per line
# ("<rawECG>,<LO+>,<LO->") as fast as the serial link allows -
# no 10-sample smoothing, no once-a-second gating. Every sample
# that arrives during the next RAW_ECG_CAPTURE_SECONDS is kept,
# giving several hundred real points instead of 10 coarse
# averages, so the waveform actually has real QRS shape for the
# fusion model (and for the results chart) to work with. Once
# the window closes the backend sends 'H' to put the sketch back
# into Health Data Mode and writes the capture to disk as both a
# .dat file and an .xlsx workbook under ECG_CAPTURE_DIR.
# ============================================================

RAW_ECG_CAPTURE_SECONDS = 10

ECG_CAPTURE_DIR = os.path.join(
    BACKEND_DIR,
    "ecg_captures"
)

# Heart-rate limits used for the hardware risk flag.
# The sketch clips BPM at 90, so 90 is the upper limit here.
HEART_RATE_LOW_LIMIT = 60
HEART_RATE_HIGH_LIMIT = 90


def hardware_heart_risk(heartbeat):
    """Return True when the averaged BPM is outside the safe band."""
    try:
        heartbeat = float(heartbeat)
    except (TypeError, ValueError):
        return False

    if heartbeat <= 0:
        return False

    return (
        heartbeat < HEART_RATE_LOW_LIMIT
        or
        heartbeat >= HEART_RATE_HIGH_LIMIT
    )


def heart_risk_state(heartbeat_avg):
    """
    Tri-state heart-risk verdict for the Hardware tab badge:
      "waiting" - no valid BPM captured yet (pulse sensor hasn't
                  detected a beat), SpO2/Temperature can still be
                  live while this is showing.
      "risk"    - averaged BPM is outside the safe band.
      "safe"    - averaged BPM is inside the safe band.
    """

    if heartbeat_avg is None:
        return "waiting"

    if hardware_heart_risk(heartbeat_avg):
        return "risk"

    return "safe"


def save_raw_ecg_files(samples, fs, duration):
    """
    Save one real raw ECG capture to disk in two formats under
    ECG_CAPTURE_DIR: a plain .dat text file (one sample per line,
    for the fusion model / load_ecg_dat_file) and an .xlsx
    workbook (Sample #, Time (s), ECG Value columns, for opening
    directly in Excel). Returns (dat_path, xlsx_path); xlsx_path
    is None if openpyxl isn't installed or the write fails.
    """

    os.makedirs(ECG_CAPTURE_DIR, exist_ok=True)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")

    dat_path = os.path.join(
        ECG_CAPTURE_DIR,
        f"ecg_raw_{stamp}.dat"
    )

    header = (
        "# Raw ECG capture - "
        f"{len(samples)} samples over {duration}s "
        f"(~{fs} Hz)"
    )

    with open(dat_path, "w", encoding="utf-8") as handle:

        handle.write(header + "\n")

        for value in samples:
            handle.write(f"{value}\n")

    xlsx_path = None

    if OPENPYXL_AVAILABLE:

        try:
            xlsx_candidate = os.path.join(
                ECG_CAPTURE_DIR,
                f"ecg_raw_{stamp}.xlsx"
            )

            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "ECG Raw Capture"

            sheet.append(["Sample #", "Time (s)", "ECG Value"])

            for index, value in enumerate(samples):
                time_s = round(index / fs, 4) if fs else index
                sheet.append([index + 1, time_s, value])

            workbook.save(xlsx_candidate)
            xlsx_path = xlsx_candidate

        except Exception as error:
            print(
                "[hardware] Could not write ECG .xlsx file:",
                error
            )
            xlsx_path = None

    return dat_path, xlsx_path


def load_ecg_dat_file(path):
    """
    Read a saved .dat file back from disk and return its readings
    as a list of floats (header/comment lines and blanks skipped).
    This is what makes "Run Fusion Analysis" and the results page
    show the waveform that is actually on disk, not just whatever
    is still sitting in memory.
    """

    if not path or not os.path.exists(path):
        return []

    values = []

    with open(path, "r", encoding="utf-8") as handle:

        for line in handle:

            line = line.strip()

            if not line or line.startswith("#"):
                continue

            try:
                values.append(float(line))
            except ValueError:
                continue

    return values


# ============================================================
# SERIAL WORKER
# ============================================================

# Number of valid readings averaged together for the
# "avg" fields (~20s of samples at the sketch's 2s rate).
AVERAGE_WINDOW = 10


class SerialWorker:

    def __init__(self):
        self.lock = threading.Lock()
        self.serial_conn = None
        self.thread = None
        self.running = False
        self.port = None
        self.error = None
        self.latest = None
        self.log = deque(maxlen=50)
        self.pending = {}

        # Independent rolling windows so a missing/failed reading
        # on one sensor never blocks the other two from updating.
        self.temp_window = deque(maxlen=AVERAGE_WINDOW)
        self.spo2_window = deque(maxlen=AVERAGE_WINDOW)
        self.heart_window = deque(maxlen=AVERAGE_WINDOW)

        # REAL 10-SECOND RAW ECG CAPTURE
        # An on-demand capture (started explicitly, e.g. when
        # "Run Fusion Analysis" is clicked) - not something that
        # runs automatically in the background. While active the
        # sketch is in Graph Mode streaming raw, unaveraged
        # samples; _handle_line hands every line straight to
        # _handle_raw_ecg_line instead of the health-data parser
        # until the window closes.
        self.raw_ecg_active = False
        self.raw_ecg_samples = []
        self.raw_ecg_start_time = None
        self.raw_ecg_duration = RAW_ECG_CAPTURE_SECONDS
        self.raw_ecg_result = None
        self.raw_ecg_error = None

    def reset_windows(self):
        self.temp_window.clear()
        self.spo2_window.clear()
        self.heart_window.clear()
        self.pending = {}

    def reset_ecg_capture(self):
        self.raw_ecg_active = False
        self.raw_ecg_samples = []
        self.raw_ecg_start_time = None
        self.raw_ecg_result = None
        self.raw_ecg_error = None

    def start_raw_ecg_capture(self):
        """
        Kick off a real RAW_ECG_CAPTURE_SECONDS-long capture: put
        the sketch into Graph Mode ('G') and start collecting raw
        samples in _handle_raw_ecg_line as they stream in. Raises
        RuntimeError if the device isn't connected or a capture is
        already running.
        """

        with self.lock:

            if not self.running or not self.serial_conn:
                raise RuntimeError(
                    "Device is not connected."
                )

            if self.raw_ecg_active:
                raise RuntimeError(
                    "An ECG capture is already running."
                )

            self.raw_ecg_active = True
            self.raw_ecg_samples = []
            self.raw_ecg_start_time = time.time()
            self.raw_ecg_result = None
            self.raw_ecg_error = None

        try:
            self.serial_conn.write(b"G")

        except Exception as error:

            with self.lock:
                self.raw_ecg_active = False
                self.raw_ecg_error = str(error)

            raise RuntimeError(
                f"Could not start ECG capture: {error}"
            )

    def raw_ecg_status(self):
        """
        Current raw-capture status for the frontend to poll:
        while active, how far along it is; once finished, the
        result (or the error, if the capture never got started).
        """

        with self.lock:

            if self.raw_ecg_active:

                elapsed = (
                    time.time() - self.raw_ecg_start_time
                )

                return {
                    "active": True,
                    "elapsed": round(elapsed, 1),
                    "duration": self.raw_ecg_duration,
                    "count": len(self.raw_ecg_samples),
                    "result": None,
                    "error": None
                }

            return {
                "active": False,
                "elapsed": 0,
                "duration": self.raw_ecg_duration,
                "count": (
                    len(self.raw_ecg_result["samples"])
                    if self.raw_ecg_result
                    else 0
                ),
                "result": self.raw_ecg_result,
                "error": self.raw_ecg_error
            }

    def _handle_raw_ecg_line(self, line):
        """
        Called instead of the health-data parser while a raw
        capture is active. Expects the sketch's Graph Mode CSV
        line ("<rawECG>,<LO+>,<LO->"); the header line
        ("ECG,LO_PLUS,LO_MINUS") and any stray text simply fail
        the float() conversion below and are skipped.
        """

        first = line.split(",")[0].strip()

        try:
            value = float(first)
        except ValueError:
            return

        finished = False

        with self.lock:

            if not self.raw_ecg_active:
                return

            self.raw_ecg_samples.append(value)

            elapsed = (
                time.time() - self.raw_ecg_start_time
            )

            if elapsed >= self.raw_ecg_duration:
                finished = True

        if finished:
            self._finish_raw_ecg_capture()

    def _finish_raw_ecg_capture(self):
        """
        Closes out an active raw capture: stops collecting, tells
        the sketch to go back to Health Data Mode ('H'), works out
        the real achieved sample rate from elapsed wall-clock time
        (not an assumed constant), and saves the capture to disk
        as both a .dat file and an .xlsx workbook.
        """

        with self.lock:

            if not self.raw_ecg_active:
                return

            samples = list(self.raw_ecg_samples)
            elapsed = time.time() - self.raw_ecg_start_time
            self.raw_ecg_active = False

        try:
            if self.serial_conn:
                self.serial_conn.write(b"H")
        except Exception:
            pass

        count = len(samples)
        fs = round(count / elapsed, 2) if elapsed > 0 else 0.0

        dat_path = None
        xlsx_path = None

        try:
            dat_path, xlsx_path = save_raw_ecg_files(
                samples, fs, round(elapsed, 2)
            )
        except Exception as error:
            print(
                "[hardware] Could not write raw ECG capture "
                "files:",
                error
            )

        result = {
            "samples": samples,
            "count": count,
            "duration": round(elapsed, 2),
            "fs": fs,
            "csv": "\n".join(str(v) for v in samples),
            "dat_file": (
                os.path.basename(dat_path) if dat_path else None
            ),
            "xlsx_file": (
                os.path.basename(xlsx_path) if xlsx_path else None
            )
        }

        with self.lock:
            self.raw_ecg_result = result
            self.raw_ecg_error = (
                None if count > 0 else "No ECG samples were received."
            )

        print()
        print("=" * 52)
        print("   RAW ECG CAPTURE COMPLETE")
        print("=" * 52)
        print(f"   Samples captured : {count}")
        print(f"   Duration         : {result['duration']} s")
        print(f"   Effective rate   : {fs} Hz")
        if dat_path:
            print(f"   Saved (.dat)     : {dat_path}")
        if xlsx_path:
            print(f"   Saved (.xlsx)    : {xlsx_path}")
        print("=" * 52)
        print("   Ready for Run Fusion Analysis.")
        print()

    def start(self, port, baud=9600):

        with self.lock:

            if self.running:
                return True, None

            if not SERIAL_AVAILABLE:
                return False, "pyserial is not installed"

            try:
                self.serial_conn = serial.Serial(
                    port,
                    baud,
                    timeout=1
                )

                time.sleep(2)

                try:
                    self.serial_conn.reset_input_buffer()
                except Exception:
                    pass

            except Exception as error:
                self.error = str(error)
                return False, str(error)

            self.running = True
            self.port = port
            self.error = None
            self.latest = None
            self.reset_windows()
            self.reset_ecg_capture()

            self.thread = threading.Thread(
                target=self._loop,
                daemon=True
            )

            self.thread.start()

            return True, None

    def stop(self):

        with self.lock:
            self.running = False
            self.reset_ecg_capture()

        if self.thread:
            self.thread.join(timeout=2)

        if self.serial_conn:
            try:
                self.serial_conn.close()
            except Exception:
                pass

        self.serial_conn = None
        self.thread = None
        self.port = None

    def recalculate(self):

        with self.lock:
            self.latest = None
            self.reset_windows()
            self.reset_ecg_capture()

            if self.serial_conn:
                try:
                    self.serial_conn.reset_input_buffer()
                except Exception:
                    pass

    def _finalize_block(self):
        """
        Called at the closing "====...====" line of a health-data
        block. Whatever fields we picked up this block (some may be
        missing - a failed DHT11 read, or no heartbeat detected yet)
        are applied to their own independent rolling window, so one
        missing sensor never blocks the others from updating.
        """

        heartbeat = self.pending.pop("heartbeat", None)
        temperature_c = self.pending.pop("temperature", None)
        humidity = self.pending.pop("humidity", None)
        spo2_raw = self.pending.pop("spo2", None)
        ecg = self.pending.pop("ecg", None)

        # --------------------------------------------------------
        # ECG WAVEFORM SAMPLE
        # "ecg" here is just this cycle's on-the-wire "ECG Average
        # (10)" value from the health-data block - kept below only
        # as a decorative per-cycle number (reading["ecg"]). It is
        # NOT what gets analyzed: the real ECG signal used for "Run
        # Fusion Analysis" comes from the separate on-demand raw
        # capture (start_raw_ecg_capture / _handle_raw_ecg_line),
        # which streams genuine unaveraged samples for a full 10
        # real seconds instead of one smoothed value per second.
        # --------------------------------------------------------

        # --------------------------------------------------------
        # TEMPERATURE / SpO2
        # Added to their own windows whenever this block reported
        # them - no dependency on heartbeat or ECG being present.
        # --------------------------------------------------------

        temperature_value = (
            temperature_reading_celsius(temperature_c)
            if temperature_c is not None
            else None
        )

        if spo2_raw is not None:
            spo2_value = round(float(spo2_raw), 1)
        elif humidity is not None:
            spo2_value = spo2_from_humidity_demo(humidity)
        else:
            spo2_value = None

        # --------------------------------------------------------
        # HEART RATE
        # Do not invent a heartbeat when Arduino reports 0/"Waiting
        # for heartbeat...". Only a real positive BPM is added to
        # the rolling average; until then heartbeat_avg stays None
        # ("waiting") without holding up temperature/SpO2/ECG.
        # --------------------------------------------------------

        heartbeat_value = None

        if heartbeat is not None:
            heartbeat = float(heartbeat)

            if heartbeat > 0:
                heartbeat_value = round(heartbeat, 1)
            else:
                print(
                    "[hardware] Waiting for valid heartbeat "
                    f"(Arduino sent {heartbeat})"
                )

        # --------------------------------------------------------
        # LOCKED AVERAGES (first AVERAGE_WINDOW readings only)
        # Collect the first AVERAGE_WINDOW valid readings per
        # sensor and average them once each sensor's window fills.
        # After that, that sensor's average holds steady instead
        # of continuing to drift. Disconnect/reconnect (or
        # Recalculate) starts a fresh batch.
        # --------------------------------------------------------

        with self.lock:

            if temperature_value is not None and len(self.temp_window) < AVERAGE_WINDOW:
                self.temp_window.append(temperature_value)

            if spo2_value is not None and len(self.spo2_window) < AVERAGE_WINDOW:
                self.spo2_window.append(spo2_value)

            if heartbeat_value is not None and len(self.heart_window) < AVERAGE_WINDOW:
                self.heart_window.append(heartbeat_value)

            temperature_avg = (
                round(sum(self.temp_window) / len(self.temp_window), 1)
                if self.temp_window
                else None
            )

            spo2_avg = (
                round(sum(self.spo2_window) / len(self.spo2_window), 1)
                if self.spo2_window
                else None
            )

            heartbeat_avg = (
                round(sum(self.heart_window) / len(self.heart_window), 1)
                if self.heart_window
                else None
            )

            sample_count = max(
                len(self.temp_window),
                len(self.spo2_window)
            )

            heart_sample_count = len(self.heart_window)

        # Nothing at all captured yet (e.g. a block full of DHT
        # read errors with no ECG/heartbeat either) - skip
        # publishing rather than showing an all-blank reading.
        if (
            temperature_avg is None
            and spo2_avg is None
            and heartbeat_avg is None
            and ecg is None
        ):
            return

        risk_state = heart_risk_state(heartbeat_avg)

        risk_text = {
            "waiting": "Waiting for heart rate",
            "risk": "HEART RISK DETECTED",
            "safe": "No heart risk detected"
        }[risk_state]

        reading = {
            "timestamp": time.time(),

            # Actual HW-827 / Arduino BPM (this cycle only,
            # None while waiting for the first valid beat)
            "heartbeat": heartbeat_value,
            "heartbeat_display": heartbeat_value,
            "heartbeat_is_fallback": False,

            # Actual DHT11 Celsius value (this cycle only)
            "temperature": temperature_value,

            # Kept only for debugging/reference
            "humidity": (
                round(float(humidity), 1)
                if humidity is not None
                else None
            ),

            # Demo mapping requested for this project
            "spo2": spo2_value,

            # Averaged ECG sample for this cycle
            "ecg": (
                round(float(ecg), 2)
                if ecg is not None
                else None
            ),

            # Risk flag/verdict from the averaged heart rate
            "heart_risk": risk_state == "risk",
            "heart_risk_state": risk_state,
            "heart_risk_text": risk_text,

            # --------------------------------------------------
            # Each average locks once AVERAGE_WINDOW valid
            # readings have been collected for that sensor.
            # sample_count covers temperature/SpO2 (they arrive
            # together every cycle); heart_sample_count is
            # tracked separately since the pulse sensor may take
            # longer (or never) detect a beat.
            # --------------------------------------------------
            "heartbeat_avg": heartbeat_avg,
            "temperature_avg": temperature_avg,
            "spo2_avg": spo2_avg,
            "sample_count": sample_count,
            "heart_sample_count": heart_sample_count,
            "average_window": AVERAGE_WINDOW
        }

        reading["ecg_capture"] = self.raw_ecg_status()

        with self.lock:
            self.latest = reading
            self.log.append(reading)

        print(
            "[hardware]",
            f"ECG Avg: {reading['ecg']} |",
            f"Heart Rate: {heartbeat_value} bpm "
            f"(avg {heartbeat_avg} over {heart_sample_count}) |",
            f"Temperature: {temperature_value} \u00b0C "
            f"(avg {temperature_avg}) |",
            f"SpO2: {spo2_value}% (avg {spo2_avg})"
        )

    def _handle_line(self, line):

        line = line.strip()

        if not line:
            return

        # While a real 10-second raw ECG capture is running, every
        # line is a Graph Mode CSV sample, not a health-data line -
        # hand it straight to the raw-capture parser and skip the
        # normal health-data parsing below entirely (otherwise the
        # generic CSV auto-detect just below would misread a raw
        # "512,0,0" ECG/LO+/LO- line as heartbeat/temperature/
        # humidity).
        if self.raw_ecg_active:
            self._handle_raw_ecg_line(line)
            return

        # CSV format (kept for compatibility with simpler
        # sketches):
        # heartbeat,temperature,humidity
        parts = [
            part.strip()
            for part in line.split(",")
        ]

        if len(parts) >= 3:
            try:
                heartbeat = float(parts[0])
                temperature = float(parts[1])
                humidity = float(parts[2])

                self.pending = {
                    "heartbeat": heartbeat,
                    "temperature": temperature,
                    "humidity": humidity
                }

                self._finalize_block()
                self.pending = {}
                return

            except ValueError:
                pass

        # --------------------------------------------------------
        # BLOCK BOUNDARIES
        # A reading is whatever field lines land between two
        # "=====...=====" (pure "=") lines. That works whether the
        # sketch prints the whole banner as one combined line
        # ("========== HEALTH DATA ==========", matched by
        # BLOCK_START_RE below and otherwise ignored) or spreads it
        # across three lines (a bare "=====" banner-open line, a
        # title line such as "HEALTH READINGS" with no "=" at all,
        # then a bare "=====" banner-close line) - either way, only
        # the line that closes an already-populated block finalizes
        # it, so a banner or title line with nothing collected yet
        # never fires a finalize on its own.
        # --------------------------------------------------------

        if BLOCK_END_RE.match(line):
            if self.pending:
                self._finalize_block()
            self.pending = {}
            return

        if BLOCK_START_RE.search(line):
            self.pending = {}
            return

        if DHT_ERROR_RE.search(line):
            return

        # Labeled Arduino format:
        #   ECG Avg (10) : 512           HW-827 Avg (10) : 530
        #   Temperature  : 31.5 C        Humidity        : 46 %
        #   SpO2         : 91 %          Heart Rate      : 72 BPM
        #
        # Fields are collected as they arrive and only applied
        # once the closing "====...====" line is seen above, so
        # missing lines (a failed DHT11 read, "Waiting for
        # heartbeat...") simply leave that one field out instead
        # of blocking the whole reading.

        ecg_match = ECG_RE.search(line)

        if ecg_match:
            self.pending["ecg"] = float(
                ecg_match.group(1)
            )

        heartbeat_match = HEARTBEAT_RE.search(line)

        if heartbeat_match:
            self.pending["heartbeat"] = float(
                heartbeat_match.group(1)
            )

        temperature_match = TEMPERATURE_RE.search(line)

        if temperature_match:
            self.pending["temperature"] = float(
                temperature_match.group(1)
            )

        humidity_match = HUMIDITY_RE.search(line)

        if humidity_match:
            self.pending["humidity"] = float(
                humidity_match.group(1)
            )

        spo2_match = SPO2_RE.search(line)

        if spo2_match:
            self.pending["spo2"] = float(
                spo2_match.group(1)
            )

    def _loop(self):

        while self.running:

            try:
                raw = (
                    self.serial_conn
                    .readline()
                    .decode(
                        "utf-8",
                        errors="ignore"
                    )
                    .strip()
                )

                if raw:
                    self._handle_line(raw)

            except Exception as error:

                with self.lock:
                    self.error = str(error)

                time.sleep(1)

    def snapshot(self):

        with self.lock:
            running = self.running
            port = self.port
            error = self.error
            latest = self.latest

        return {
            "running": running,
            "port": port,
            "error": error,
            "latest": latest,

            # Raw ECG capture progress/result for the
            # Hardware tab (only meaningful while/after
            # "Run Fusion Analysis" has triggered one)
            "ecg_capture": self.raw_ecg_status()
        }


# ============================================================
# GLOBAL SERIAL WORKER
# ============================================================

worker = SerialWorker()


# ============================================================
# LIST AVAILABLE COM PORTS
# ============================================================

def list_ports():

    if not SERIAL_AVAILABLE:

        return []


    return [

        port.device

        for port
        in serial.tools.list_ports.comports()
    ]


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="ECG Vitals Fusion"
)


app.add_middleware(

    CORSMiddleware,

    allow_origins=[
        "*"
    ],

    allow_credentials=True,

    allow_methods=[
        "*"
    ],

    allow_headers=[
        "*"
    ]
)


# ============================================================
# CURRENT LOGGED-IN USER
# ============================================================

def get_current_user(

    authorization:
        Optional[str]
        =
        Header(None),

    db:
        Session
        =
        Depends(get_db)
):

    if (
        not authorization
        or
        not authorization.startswith(
            "Bearer "
        )
    ):

        raise HTTPException(

            status_code=401,

            detail=(
                "Missing or invalid "
                "Authorization header"
            )
        )


    token = authorization.split(
        " ",
        1
    )[1]


    token_data = verify_token(
        token
    )


    if not token_data:

        raise HTTPException(

            status_code=401,

            detail=(
                "Invalid or expired token"
            )
        )


    user = (

        db.query(User)

        .filter(
            User.id
            ==
            token_data[
                "user_id"
            ]
        )

        .first()
    )


    if not user:

        raise HTTPException(

            status_code=401,

            detail="User not found"
        )


    return user


# ============================================================
# API HEALTH
# ============================================================

@app.get(
    "/api/health"
)

def health():

    return {

        "status":
            "ok",

        "model":
            os.path.basename(
                MODEL_PATH
            ),

        "device":
            str(
                DEVICE
            ),

        "clinical_features":
            3,

        "temperature_unit":
            "Celsius"
    }


# ============================================================
# REGISTER
# ============================================================

@app.post(
    "/api/register"
)

def register(

    payload:
        RegisterRequest,

    db:
        Session
        =
        Depends(get_db)
):

    existing_username = (

        db.query(User)

        .filter(
            User.username
            ==
            payload.username
        )

        .first()
    )


    if existing_username:

        raise HTTPException(

            status_code=400,

            detail=(
                "Username already taken"
            )
        )


    existing_email = (

        db.query(User)

        .filter(
            User.email
            ==
            payload.email
        )

        .first()
    )


    if existing_email:

        raise HTTPException(

            status_code=400,

            detail=(
                "Email already registered"
            )
        )


    user = User(

        username=
            payload.username,

        email=
            payload.email,

        password_hash=
            hash_password(
                payload.password
            )
    )


    db.add(
        user
    )

    db.commit()

    db.refresh(
        user
    )


    return {

        "token":
            create_token(
                user.id
            ),

        "username":
            user.username
    }


# ============================================================
# LOGIN
# ============================================================

@app.post(
    "/api/login"
)

def login(

    payload:
        LoginRequest,

    db:
        Session
        =
        Depends(get_db)
):

    user = (

        db.query(User)

        .filter(
            User.username
            ==
            payload.username
        )

        .first()
    )


    if (

        not user

        or

        not verify_password(

            payload.password,

            user.password_hash
        )
    ):

        raise HTTPException(

            status_code=401,

            detail=(
                "Invalid username "
                "or password"
            )
        )


    return {

        "token":
            create_token(
                user.id
            ),

        "username":
            user.username
    }


TELEGRAM_SSL_CONTEXT = ssl.create_default_context(
    cafile=certifi.where()
)


# ============================================================
# TELEGRAM ALERTS
# ============================================================
# Hardware behavior is intentionally unchanged: Medium only.
# Enter Data / software behavior: Medium + High.
# Keep these credentials private.
TELEGRAM_BOT_TOKEN = "8633995386:AAFipZ4ZLugn5OPB6P2LdrVs7iAEzz0auh0"
TELEGRAM_CHAT_ID = "6932634069"


def send_telegram_alert(
    result: dict,
    user_id: int | None = None,
    allow_high: bool = False
):
    """Send Telegram alerts without changing screening conditions.

    Hardware calls this with allow_high=False -> Medium only.
    Enter Data calls this with allow_high=True -> Medium + High.
    """
    overall_status = (
        result.get("overall_screening_status")
        or result.get("overall_status")
    )
    status = str(overall_status or "").strip().lower()

    # DO NOT change hardware behavior: Medium only.
    if not allow_high:
        if status != "medium":
            return False
    # Enter Data / software: Medium and High.
    else:
        if status not in ("medium", "high"):
            return False

    message = (
        "🚨 ECG Vitals Fusion Alert\n\n"
        f"Overall Screening Status: {overall_status}\n"
        f"Heart Block Risk: {result.get('heart_block_risk', 'N/A')}\n"
        f"Pulmonary Hypertension Risk: {result.get('pulmonary_hypertension_risk', 'N/A')}\n"
        f"SpO₂: {result.get('spo2', 'N/A')}\n"
        f"Heart Rate: {result.get('heart_rate', 'N/A')}\n"
        f"Temperature: {result.get('temperature', 'N/A')}\n\n"
        f"Recommendation: {result.get('recommendation', 'N/A')}"
    )

    if user_id is not None:
        message = f"User ID: {user_id}\n" + message

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = urllib.parse.urlencode({
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
    }).encode("utf-8")

    try:
        request = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded"
            },
            method="POST",
        )

        with urllib.request.urlopen(
            request,
            timeout=10,
            context=TELEGRAM_SSL_CONTEXT
        ) as response:
            raw_response = response.read().decode("utf-8", errors="replace")

        # Telegram can return HTTP 200 with {"ok": false}, so check it.
        try:
            telegram_result = json.loads(raw_response)
        except json.JSONDecodeError:
            print("[TELEGRAM ERROR] Invalid Telegram response:", raw_response)
            return False

        if not telegram_result.get("ok", False):
            print(
                "[TELEGRAM ERROR]",
                telegram_result.get("description", "Telegram rejected the request")
            )
            return False

        print(
            f"[TELEGRAM] {overall_status} alert sent successfully."
        )
        return True

    except urllib.error.HTTPError as error:
        try:
            details = error.read().decode("utf-8", errors="replace")
        except Exception:
            details = str(error)
        print("[TELEGRAM HTTP ERROR]", details)
        return False

    except urllib.error.URLError as error:
        print("[TELEGRAM CONNECTION ERROR]", error)
        return False

    except Exception as error:
        print("[TELEGRAM ERROR]", error)
        return False


# ============================================================
# FUSION MODEL CHECK
# ============================================================

@app.post(
    "/api/check/clinical"
)

def check_clinical(

    payload:
        ClinicalCheckRequest,

    user:
        User
        =
        Depends(
            get_current_user
        ),

    db:
        Session
        =
        Depends(
            get_db
        )
):

    data = payload.model_dump()


    ecg_csv = data.pop(
        "ecg_csv",
        None
    )


    ecg_fs = data.pop(
        "ecg_fs",
        250
    ) or 250


    source = data.pop(
        "source",
        "clinical"
    ) or "clinical"


    try:

        result = predict_fusion(

            data,

            ecg_csv,

            ecg_fs,

            source
        )


    except Exception as error:

        print(
            "[PREDICTION ERROR]",
            error
        )


        raise HTTPException(

            status_code=400,

            detail=(
                "Prediction failed: "
                f"{error}"
            )

        ) from error


    # Store the exact screening output alongside the submitted values.
    # This keeps Recent Checks tied to the result that was actually returned
    # by the screening model (no confidence-based reclassification later).
    history_input = {

        **data,

        **result,

        "ecg_uploaded":
            bool(
                ecg_csv
            ),

        "ecg_fs":
            ecg_fs,

        "source":
            source
    }


    record = Prediction(

        user_id=
            user.id,


        check_type=
            "hardware"
            if source == "hardware"
            else "clinical",


        input_json=
            json.dumps(
                history_input
            ),


        result=
            result[
                "result"
            ],


        confidence=
            result[
                "confidence"
            ]
    )


    db.add(
        record
    )

    db.commit()

    # HARDWARE: keep the existing Medium-only Telegram behavior.
    # SOFTWARE / ENTER DATA: send for Medium and High.
    if source == "hardware":
        send_telegram_alert(result, user.id)
    else:
        send_telegram_alert(result, user.id, allow_high=True)

    return result


# ============================================================
# HISTORY
# ============================================================

@app.get(
    "/api/history"
)

def history(

    user:
        User
        =
        Depends(
            get_current_user
        ),

    db:
        Session
        =
        Depends(
            get_db
        )
):

    records = (

        db.query(
            Prediction
        )

        .filter(
            Prediction.user_id
            ==
            user.id
        )

        .order_by(
            Prediction.created_at.desc()
        )

        .all()
    )


    history_items = []

    for record in records:

        try:
            stored = json.loads(record.input_json or "{}")
        except Exception:
            stored = {}

        overall_status = (
            stored.get("overall_screening_status")
            or stored.get("overall_status")
        )

        # Older rows may not contain the final screening status because it was
        # not persisted in earlier versions. Never derive High/Medium/Low from
        # confidence or Normal/Abnormal; report it as unavailable instead.
        if not overall_status:
            overall_status = "Not available"

        history_items.append({
            "id": record.id,
            "check_type": record.check_type,
            "result": record.result,
            "confidence": record.confidence,
            "overall_screening_status": overall_status,
            "heart_block_risk": stored.get("heart_block_risk"),
            "pulmonary_hypertension_risk": stored.get("pulmonary_hypertension_risk"),
            "spo2": stored.get("spo2"),
            "heart_rate": stored.get("heart_rate"),
            "temperature": stored.get("temperature"),
            "created_at": record.created_at.isoformat()
        })

    return history_items


# ============================================================
# HARDWARE PORTS
# ============================================================

@app.get(
    "/api/hardware/ports"
)

def hardware_ports(

    user:
        User
        =
        Depends(
            get_current_user
        )
):

    return {

        "ports":
            list_ports(),

        "serial_available":
            SERIAL_AVAILABLE
    }


# ============================================================
# HARDWARE CONNECT
# ============================================================

@app.post(
    "/api/hardware/connect"
)

def hardware_connect(

    payload:
        HardwareConnectRequest,

    user:
        User
        =
        Depends(
            get_current_user
        )
):

    success, error = worker.start(

        payload.port,

        payload.baud
        or
        9600
    )


    if not success:

        raise HTTPException(

            status_code=500,

            detail=(
                error
                or
                "Could not open serial port"
            )
        )


    return {

        "status":
            "connected",

        "port":
            payload.port
    }


# ============================================================
# HARDWARE DISCONNECT
# ============================================================

@app.post(
    "/api/hardware/disconnect"
)

def hardware_disconnect(

    user:
        User
        =
        Depends(
            get_current_user
        )
):

    worker.stop()


    return {
        "status":
            "disconnected"
    }


# ============================================================
# HARDWARE LIVE STREAM
# ============================================================

@app.get(
    "/api/hardware/stream"
)

def hardware_stream(

    user:
        User
        =
        Depends(
            get_current_user
        )
):

    return worker.snapshot()


# ============================================================
# HARDWARE RECALCULATE
# ============================================================

@app.post(
    "/api/hardware/recalculate"
)

def hardware_recalculate(

    user:
        User
        =
        Depends(
            get_current_user
        )
):

    if not worker.running:

        raise HTTPException(

            status_code=400,

            detail=(
                "Not connected "
                "to a serial port"
            )
        )


    worker.recalculate()


    return {
        "status":
            "collecting"
    }


# ============================================================
# REAL RAW ECG CAPTURE (10 real seconds)
#
# start:  puts the sketch into Graph Mode and begins collecting
#         genuine unaveraged ECG samples for RAW_ECG_CAPTURE_
#         SECONDS. Call this, then poll status until it reports
#         active: false.
# status: current progress while capturing, or the finished
#         result (samples/fs/csv/.dat/.xlsx filenames) once done.
# ============================================================

@app.post(
    "/api/hardware/ecg/capture/start"
)

def hardware_ecg_capture_start(

    user:
        User
        =
        Depends(
            get_current_user
        )
):

    try:
        worker.start_raw_ecg_capture()

    except RuntimeError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )


    return {
        "started": True,
        "duration": RAW_ECG_CAPTURE_SECONDS
    }


@app.get(
    "/api/hardware/ecg/capture/status"
)

def hardware_ecg_capture_status(

    user:
        User
        =
        Depends(
            get_current_user
        )
):

    return worker.raw_ecg_status()


# ============================================================
# HARDWARE ECG WAVEFORM
#
# Status/result of the most recent real raw ECG capture (see
# above) - kept under the original path for compatibility with
# anything still polling it directly.
# ============================================================

@app.get(
    "/api/hardware/ecg"
)

def hardware_ecg(

    user:
        User
        =
        Depends(
            get_current_user
        )
):

    return worker.raw_ecg_status()


# ============================================================
# SERVE FRONTEND
# ============================================================

if not os.path.isdir(
    FRONTEND_DIR
):

    raise RuntimeError(
        f"Frontend folder not found: {FRONTEND_DIR}"
    )


app.mount(

    "/static",

    StaticFiles(
        directory=
            FRONTEND_DIR
    ),

    name=
        "static"
)


# ============================================================
# LANDING PAGE
# ============================================================

@app.get("/")

def serve_landing():

    return FileResponse(

        os.path.join(
            FRONTEND_DIR,
            "index.html"
        )
    )


# ============================================================
# SERVE OTHER HTML PAGES
# ============================================================

@app.get(
    "/{page_name}.html"
)

def serve_page(
    page_name: str
):

    file_path = os.path.join(

        FRONTEND_DIR,

        f"{page_name}.html"
    )


    if os.path.exists(
        file_path
    ):

        return FileResponse(
            file_path
        )


    raise HTTPException(

        status_code=404,

        detail="Page not found"
    )