import { FormEvent, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Role = 'community' | 'district' | 'regional' | 'national' | 'admin';

type CaseItem = {
  id: number;
  reference: string;
  incident_type: string;
  incident_date?: string | null;
  location?: string | null;
  survivor_code: string;
  consent_to_share: boolean;
  consent_scope?: string | null;
  status: string;
  current_level: Role;
  created_at: string;
};

type Detail = {
  case: CaseItem;
  reports: any[];
  referrals: any[];
  services: any[];
  outcome: any;
};

type UserInfo = {
  id: number;
  username: string;
  role: Role;
};

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function api(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const headers = new Headers(options.headers || {});

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API}${path}`, { ...options, headers });
  const text = await response.text();

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (response.status === 401) {
    localStorage.removeItem('token');
    throw new Error('Your session has expired. Please sign in again.');
  }

  if (!response.ok) {
    const message =
      typeof data === 'object' && data?.detail
        ? data.detail
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [registerMode, setRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('community');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');

    try {
      const payload = registerMode ? { username, password, role } : { username, password };
      const data = await api(registerMode ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      localStorage.setItem('token', data.access_token);
      onLogin();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-panel card">
        <h1>GBV Case Management</h1>
        <p className="muted">Use only survivor codes and minimal consent metadata. Never store names or unnecessary identifiers.</p>

        {error && <div className="alert danger">{error}</div>}

        <form onSubmit={submit} className="stack">
          <input required minLength={3} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input required minLength={12} type="password" placeholder="Password (12+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />

          {registerMode && (
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="community">Community</option>
              <option value="district">District</option>
              <option value="regional">Regional</option>
              <option value="national">National</option>
              <option value="admin">Admin</option>
            </select>
          )}

          <button type="submit">{registerMode ? 'Create account' : 'Sign in'}</button>
        </form>

        <button className="link-button" onClick={() => setRegisterMode((value) => !value)}>
          {registerMode ? 'Back to sign in' : 'Create a development account'}
        </button>
      </div>
    </main>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem('token')));
  const [user, setUser] = useState<UserInfo | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [duplicateQuery, setDuplicateQuery] = useState({
    survivor_code: '',
    incident_date: '',
  });
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [error, setError] = useState('');

  const [caseForm, setCaseForm] = useState({
    incident_type: '',
    incident_date: '',
    location: '',
    survivor_code: '',
    report_type: 'community_worker',
    consent_to_share: false,
    consent_scope: '',
    description: '',
  });

  async function loadUser() {
    try {
      const data = await api('/me');
      setUser(data);
    } catch (err: any) {
      setError(err.message || 'Unable to load user');
    }
  }

  async function loadCases() {
    try {
      const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const data = await api(`/cases${query}`);
      setCases(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Unable to load cases');
    }
  }

  async function loadDetail(id: number) {
    try {
      const data = await api(`/cases/${id}`);
      setDetail(data);
      setSelectedCaseId(id);
    } catch (err: any) {
      setError(err.message || 'Unable to load case detail');
    }
  }

  async function submitCase(event: FormEvent) {
    event.preventDefault();

    try {
      await api('/cases', {
        method: 'POST',
        body: JSON.stringify({
          ...caseForm,
          incident_date: caseForm.incident_date || null,
          location: caseForm.location || null,
          consent_scope: caseForm.consent_scope || null,
        }),
      });

      setCaseForm({
        incident_type: '',
        incident_date: '',
        location: '',
        survivor_code: '',
        report_type: 'community_worker',
        consent_to_share: false,
        consent_scope: '',
        description: '',
      });

      await loadCases();
    } catch (err: any) {
      setError(err.message || 'Unable to create case');
    }
  }

  async function addReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCaseId) return;

    const form = new FormData(event.currentTarget);
    const payload = {
      report_type: form.get('report_type'),
      description: form.get('description'),
    };

    try {
      await api(`/cases/${selectedCaseId}/reports`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadDetail(selectedCaseId);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Unable to add report');
    }
  }

  async function addReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCaseId) return;

    const form = new FormData(event.currentTarget);
    const payload = {
      to_level: form.get('to_level'),
      reason: form.get('reason'),
    };

    try {
      await api(`/cases/${selectedCaseId}/referrals`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadDetail(selectedCaseId);
      await loadCases();
      setError('');
    } catch (err: any) {
      setError(err.message || 'Unable to make referral');
    }
  }

  async function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCaseId) return;

    const form = new FormData(event.currentTarget);
    const payload = {
      service_type: form.get('service_type'),
      provider: form.get('provider') || null,
      status: form.get('status') || 'requested',
      notes: form.get('notes') || null,
    };

    try {
      await api(`/cases/${selectedCaseId}/services`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadDetail(selectedCaseId);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Unable to add service');
    }
  }

  async function addOutcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCaseId) return;

    const form = new FormData(event.currentTarget);
    const payload = {
      result: form.get('result'),
      follow_up_required: form.get('follow_up_required') === 'on',
    };

    try {
      await api(`/cases/${selectedCaseId}/outcome`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadDetail(selectedCaseId);
      await loadCases();
      setError('');
    } catch (err: any) {
      setError(err.message || 'Unable to add outcome');
    }
  }

  async function checkDuplicates() {
    if (!duplicateQuery.survivor_code) {
      setError('Enter a survivor code to check duplicates.');
      return;
    }

    try {
      const params = new URLSearchParams({ survivor_code: duplicateQuery.survivor_code });
      if (duplicateQuery.incident_date) params.set('incident_date', duplicateQuery.incident_date);
      const data = await api(`/possible-duplicates?${params.toString()}`);
      setDuplicates(Array.isArray(data?.possible_duplicates) ? data.possible_duplicates : data || []);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Unable to check duplicates');
    }
  }

  useEffect(() => {
    if (authenticated) {
      loadUser();
      loadCases();
    }
  }, [authenticated]);

  useEffect(() => {
    if (authenticated) loadCases();
  }, [statusFilter]);

  if (!authenticated) {
    return <Login onLogin={() => setAuthenticated(true)} />;
  }

  return (
    <div className="app-shell">
      <aside className="left-panel card">
        <h2>GBV</h2>
        <div className="nav-box">
          <div className="nav-title">Staff</div>
          <div className="nav-row">{user ? `${user.username} · ${user.role}` : 'Loading...'}</div>
          <button className="secondary" onClick={() => setAuthenticated(false)}>Log out</button>
        </div>

        <div className="nav-box">
          <div className="nav-title">Filters</div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="under_review">Under review</option>
            <option value="referred">Referred</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        <div className="nav-box">
          <div className="nav-title">Duplicate check</div>
          <input
            placeholder="Survivor code"
            value={duplicateQuery.survivor_code}
            onChange={(e) => setDuplicateQuery({ ...duplicateQuery, survivor_code: e.target.value })}
          />
          <input
            type="date"
            value={duplicateQuery.incident_date}
            onChange={(e) => setDuplicateQuery({ ...duplicateQuery, incident_date: e.target.value })}
          />
          <button onClick={checkDuplicates}>Check</button>

          {duplicates.length > 0 && (
            <div className="duplicate-box">
              {duplicates.map((item: any) => (
                <div key={item.id} className="dup-item">
                  {item.reference} · {item.status} · {item.current_level}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="main-panel">
        {error && <div className="alert danger">{error}</div>}

        <section className="card">
          <h2>New case</h2>
          <form onSubmit={submitCase} className="two-col">
            <input
              required
              placeholder="Incident type"
              value={caseForm.incident_type}
              onChange={(e) => setCaseForm({ ...caseForm, incident_type: e.target.value })}
            />

            <input
              type="date"
              value={caseForm.incident_date}
              onChange={(e) => setCaseForm({ ...caseForm, incident_date: e.target.value })}
            />

            <input
              placeholder="General location"
              value={caseForm.location}
              onChange={(e) => setCaseForm({ ...caseForm, location: e.target.value })}
            />

            <input
              required
              placeholder="Survivor code"
              value={caseForm.survivor_code}
              onChange={(e) => setCaseForm({ ...caseForm, survivor_code: e.target.value })}
            />

            <select
              value={caseForm.report_type}
              onChange={(e) => setCaseForm({ ...caseForm, report_type: e.target.value })}
            >
              <option value="community_worker">Community worker</option>
              <option value="survivor">Survivor</option>
              <option value="caregiver">Caregiver</option>
              <option value="health_worker">Health worker</option>
              <option value="police">Police</option>
              <option value="other">Other</option>
            </select>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={caseForm.consent_to_share}
                onChange={(e) =>
                  setCaseForm({ ...caseForm, consent_to_share: e.target.checked })
                }
              />
              Consent to share
            </label>

            <input
              placeholder="Consent scope"
              value={caseForm.consent_scope}
              onChange={(e) => setCaseForm({ ...caseForm, consent_scope: e.target.value })}
            />

            <textarea
              required
              placeholder="Case description"
              value={caseForm.description}
              onChange={(e) => setCaseForm({ ...caseForm, description: e.target.value })}
            />

            <button type="submit" className="wide">Create case</button>
          </form>
        </section>

        <section className="card">
          <div className="section-head">
            <h2>Case list</h2>
            <button className="secondary" onClick={loadCases}>Refresh</button>
          </div>

          <div className="cases-grid">
            {cases.length === 0 ? (
              <p>No cases found.</p>
            ) : (
              cases.map((item) => (
                <button
                  key={item.id}
                  className="case-card"
                  onClick={() => loadDetail(item.id)}
                >
                  <div className="case-ref">{item.reference}</div>
                  <div className="case-main">{item.incident_type}</div>
                  <div className="case-meta">{item.status} · {item.current_level}</div>
                  <div className="case-meta">{item.location || 'Unspecified location'}</div>
                </button>
              ))
            )}
          </div>
        </section>

        {detail && (
          <section className="card detail-card">
            <h2>{detail.case.reference}</h2>

            <div className="detail-grid">
              <div>
                <p><strong>Incident type:</strong> {detail.case.incident_type}</p>
                <p><strong>Status:</strong> {detail.case.status}</p>
                <p><strong>Current level:</strong> {detail.case.current_level}</p>
                <p><strong>Survivor code:</strong> {detail.case.survivor_code}</p>
              </div>

              <div>
                <p><strong>Consent:</strong> {detail.case.consent_to_share ? 'Yes' : 'No'}</p>
                <p><strong>Consent scope:</strong> {detail.case.consent_scope || 'N/A'}</p>
                <p><strong>Location:</strong> {detail.case.location || 'N/A'}</p>
                <p><strong>Created:</strong> {detail.case.created_at}</p>
              </div>
            </div>

            <div className="sub-grid">
              <form onSubmit={addReport} className="mini-form">
                <h3>Add report</h3>
                <select name="report_type" defaultValue="community_worker">
                  <option value="community_worker">Community worker</option>
                  <option value="health_worker">Health worker</option>
                  <option value="police">Police</option>
                  <option value="survivor">Survivor</option>
                  <option value="caregiver">Caregiver</option>
                  <option value="other">Other</option>
                </select>
                <textarea name="description" required placeholder="Report details" />
                <button type="submit">Add report</button>
              </form>

              <form onSubmit={addReferral} className="mini-form">
                <h3>Refer upward</h3>
                <select name="to_level" defaultValue="district">
                  <option value="district">District</option>
                  <option value="regional">Regional</option>
                  <option value="national">National</option>
                </select>
                <textarea name="reason" required placeholder="Reason for referral" />
                <button type="submit">Refer case</button>
              </form>

              <form onSubmit={addService} className="mini-form">
                <h3>Add service</h3>
                <input name="service_type" placeholder="Service type" required />
                <input name="provider" placeholder="Provider" />
                <select name="status" defaultValue="requested">
                  <option value="requested">Requested</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                </select>
                <textarea name="notes" placeholder="Service notes" />
                <button type="submit">Add service</button>
              </form>

              <form onSubmit={addOutcome} className="mini-form">
                <h3>Outcome</h3>
                <textarea name="result" required placeholder="Outcome/result" />
                <label className="checkbox-row">
                  <input type="checkbox" name="follow_up_required" />
                  Follow-up required
                </label>
                <button type="submit">Save outcome</button>
              </form>
            </div>

            <div className="details-boxes">
              <div className="info-box">
                <h3>Reports</h3>
                <pre>{JSON.stringify(detail.reports, null, 2)}</pre>
              </div>

              <div className="info-box">
                <h3>Referrals</h3>
                <pre>{JSON.stringify(detail.referrals, null, 2)}</pre>
              </div>

              <div className="info-box">
                <h3>Services</h3>
                <pre>{JSON.stringify(detail.services, null, 2)}</pre>
              </div>

              <div className="info-box">
                <h3>Outcome</h3>
                <pre>{JSON.stringify(detail.outcome, null, 2)}</pre>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
