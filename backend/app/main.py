import os
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

import jwt
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field
from pwdlib import PasswordHash
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./gbv.db")
JWT_SECRET = os.getenv("JWT_SECRET", "development-secret-change-me")
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
password_hash = PasswordHash.recommended()
oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login")

class Base(DeclarativeBase): pass
class Role(str, Enum): community="community"; district="district"; regional="regional"; national="national"; admin="admin"
class CaseStatus(str, Enum): open="open"; under_review="under_review"; referred="referred"; resolved="resolved"; closed="closed"
class ReportType(str, Enum): survivor="survivor"; caregiver="caregiver"; community_worker="community_worker"; police="police"; health_worker="health_worker"; other="other"
LEVELS = {Role.community:1, Role.district:2, Role.regional:3, Role.national:4, Role.admin:99}

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(30), default=Role.community.value)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class Case(Base):
    __tablename__ = "cases"
    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    incident_type: Mapped[str] = mapped_column(String(100))
    incident_date: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    survivor_code: Mapped[str] = mapped_column(String(100), index=True)
    consent_to_share: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_scope: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default=CaseStatus.open.value)
    current_level: Mapped[str] = mapped_column(String(30), default=Role.community.value)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    report_type: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Referral(Base):
    __tablename__ = "referrals"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    from_level: Mapped[str] = mapped_column(String(30))
    to_level: Mapped[str] = mapped_column(String(30))
    reason: Mapped[str] = mapped_column(Text)
    accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Service(Base):
    __tablename__ = "services"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    service_type: Mapped[str] = mapped_column(String(100))
    provider: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="requested")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Outcome(Base):
    __tablename__ = "outcomes"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), unique=True)
    result: Mapped[str] = mapped_column(Text)
    follow_up_required: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(80))
    resource: Mapped[str] = mapped_column(String(80))
    resource_id: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

Base.metadata.create_all(engine)
app = FastAPI(title="GBV Case Management API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def db():
    session = SessionLocal()
    try: yield session
    finally: session.close()

def token_for(user: User):
    exp = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user.id), "username": user.username, "role": user.role, "exp": exp}, JWT_SECRET, algorithm="HS256")

def current_user(token: str = Depends(oauth2), session: Session = Depends(db)) -> User:
    try: payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"]); user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError): raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = session.get(User, user_id)
    if not user or not user.active: raise HTTPException(status_code=401, detail="Inactive user")
    return user

def audit(session, user, action, resource, resource_id):
    session.add(AuditLog(user_id=user.id, action=action, resource=resource, resource_id=str(resource_id))); session.commit()

def get_case(case_id, session, user):
    case = session.get(Case, case_id)
    if not case: raise HTTPException(404, "Case not found")
    if user.role != Role.admin.value and LEVELS[Role(user.role)] < LEVELS[Role(case.current_level)]: raise HTTPException(403, "Insufficient case access")
    return case

class RegisterIn(BaseModel): username: str = Field(min_length=3, max_length=120); password: str = Field(min_length=12); role: Role = Role.community
class LoginIn(BaseModel): username: str; password: str
class CaseIn(BaseModel): incident_type: str; incident_date: Optional[str] = None; location: Optional[str] = None; survivor_code: str; consent_to_share: bool = False; consent_scope: Optional[str] = None; report_type: ReportType; description: str
class ReportIn(BaseModel): report_type: ReportType; description: str
class ReferralIn(BaseModel): to_level: Role; reason: str
class ServiceIn(BaseModel): service_type: str; provider: Optional[str] = None; status: str = "requested"; notes: Optional[str] = None
class OutcomeIn(BaseModel): result: str; follow_up_required: bool = False

@app.get("/health")
def health(): return {"status":"ok"}

@app.post("/auth/register")
def register(data: RegisterIn, session: Session = Depends(db)):
    if session.scalar(select(User).where(User.username == data.username)): raise HTTPException(409, "Username already exists")
    user = User(username=data.username, password_hash=password_hash.hash(data.password), role=data.role.value)
    session.add(user); session.commit(); session.refresh(user)
    return {"access_token": token_for(user), "token_type":"bearer", "role":user.role}

@app.post("/auth/login")
def login(data: LoginIn, session: Session = Depends(db)):
    user = session.scalar(select(User).where(User.username == data.username))
    if not user or not user.active or not password_hash.verify(data.password, user.password_hash): raise HTTPException(401, "Invalid credentials")
    return {"access_token": token_for(user), "token_type":"bearer", "role":user.role}

@app.get("/me")
def me(user: User = Depends(current_user)): return {"id":user.id, "username":user.username, "role":user.role}

@app.post("/cases")
def create_case(data: CaseIn, session: Session = Depends(db), user: User = Depends(current_user)):
    ref = f"GBV-{datetime.now(timezone.utc):%Y%m%d}-{session.query(Case).count()+1:06d}"
    case = Case(reference=ref, incident_type=data.incident_type, incident_date=data.incident_date, location=data.location, survivor_code=data.survivor_code, consent_to_share=data.consent_to_share, consent_scope=data.consent_scope, current_level=user.role, created_by=user.id)
    session.add(case); session.flush(); session.add(Report(case_id=case.id, report_type=data.report_type.value, description=data.description, created_by=user.id)); session.commit(); session.refresh(case); audit(session,user,"create","case",case.id)
    return case

@app.get("/cases")
def list_cases(session: Session = Depends(db), user: User = Depends(current_user)):
    cases = session.scalars(select(Case).order_by(Case.created_at.desc())).all()
    if user.role != Role.admin.value: cases = [c for c in cases if LEVELS[Role(user.role)] >= LEVELS[Role(c.current_level)]]
    return cases

@app.get("/cases/{case_id}")
def case_detail(case_id: int, session: Session = Depends(db), user: User = Depends(current_user)):
    case = get_case(case_id,session,user)
    return {"case":case, "reports":session.scalars(select(Report).where(Report.case_id==case_id)).all(), "referrals":session.scalars(select(Referral).where(Referral.case_id==case_id)).all(), "services":session.scalars(select(Service).where(Service.case_id==case_id)).all(), "outcome":session.scalar(select(Outcome).where(Outcome.case_id==case_id))}

@app.post("/cases/{case_id}/reports")
def add_report(case_id: int, data: ReportIn, session: Session = Depends(db), user: User = Depends(current_user)):
    case=get_case(case_id,session,user)
    if not case.consent_to_share and user.role != Role.admin.value: raise HTTPException(403,"Consent required")
    item=Report(case_id=case_id,report_type=data.report_type.value,description=data.description,created_by=user.id); session.add(item); session.commit(); audit(session,user,"create","report",item.id); return item

@app.post("/cases/{case_id}/referrals")
def refer(case_id: int, data: ReferralIn, session: Session = Depends(db), user: User = Depends(current_user)):
    case=get_case(case_id,session,user)
    if LEVELS[data.to_level] <= LEVELS[Role(user.role)]: raise HTTPException(400,"Referral must go upward")
    if not case.consent_to_share and user.role != Role.admin.value: raise HTTPException(403,"Consent required")
    item=Referral(case_id=case_id,from_level=user.role,to_level=data.to_level.value,reason=data.reason,created_by=user.id); case.current_level=data.to_level.value; case.status=CaseStatus.referred.value; session.add(item); session.commit(); audit(session,user,"refer","case",case_id); return item

@app.post("/referrals/{referral_id}/accept")
def accept(referral_id:int, session:Session=Depends(db), user:User=Depends(current_user)):
    item=session.get(Referral,referral_id)
    if not item: raise HTTPException(404,"Referral not found")
    if user.role not in (item.to_level,Role.admin.value): raise HTTPException(403,"Receiving level required")
    item.accepted=True; case=session.get(Case,item.case_id); case.status=CaseStatus.under_review.value; session.commit(); audit(session,user,"accept","referral",referral_id); return item

@app.get("/possible-duplicates")
def duplicates(survivor_code:str, incident_date:Optional[str]=None, session:Session=Depends(db), user:User=Depends(current_user)):
    q=select(Case).where(Case.survivor_code==survivor_code)
    if incident_date: q=q.where(Case.incident_date==incident_date)
    return session.scalars(q).all()

@app.post("/cases/{case_id}/services")
def add_service(case_id:int,data:ServiceIn,session:Session=Depends(db),user:User=Depends(current_user)):
    get_case(case_id,session,user); item=Service(case_id=case_id,created_by=user.id,**data.model_dump()); session.add(item); session.commit(); audit(session,user,"create","service",item.id); return item

@app.post("/cases/{case_id}/outcome")
def add_outcome(case_id:int,data:OutcomeIn,session:Session=Depends(db),user:User=Depends(current_user)):
    case=get_case(case_id,session,user); item=session.scalar(select(Outcome).where(Outcome.case_id==case_id))
    if item: item.result=data.result; item.follow_up_required=data.follow_up_required
    else: item=Outcome(case_id=case_id,created_by=user.id,**data.model_dump()); session.add(item)
    case.status=CaseStatus.resolved.value; session.commit(); audit(session,user,"record","outcome",case_id); return item
