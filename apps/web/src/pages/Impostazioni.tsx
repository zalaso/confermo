import { useEffect, useState, type FormEvent } from 'react';
import {
  MIN_PASSWORD_LENGTH,
  REMINDER_KIND_LABELS,
  TEMPLATE_VARIABLES,
  VISIT_TYPE_MAX_LENGTH,
  type ClinicDto,
  type TemplateKind,
  type WhatsappSettingsDto,
} from '@confermo/shared';
import { get, post, put } from '../api';

interface TemplateRow {
  kind: TemplateKind;
  body: string;
}

export function Impostazioni({
  clinic,
  onClinicChanged,
}: {
  clinic: ClinicDto;
  onClinicChanged: () => void;
}) {
  return (
    <div>
      <StudioSection clinic={clinic} onSaved={onClinicChanged} />
      <WhatsappSection />
      <TemplatesSection />
      <PasswordSection />
    </div>
  );
}

/** Dati dello studio e tipologie di appuntamento: il prodotto non è solo per dentisti. */
function StudioSection({ clinic, onSaved }: { clinic: ClinicDto; onSaved: () => void }) {
  const [name, setName] = useState(clinic.name);
  const [types, setTypes] = useState(clinic.appointmentTypes.join('\n'));
  const [quietStart, setQuietStart] = useState(clinic.quietHoursStart);
  const [quietEnd, setQuietEnd] = useState(clinic.quietHoursEnd);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await put('/clinic', {
        name: name.trim(),
        quietHoursStart: quietStart,
        quietHoursEnd: quietEnd,
        appointmentTypes: types
          .split('\n')
          .map((t) => t.trim().slice(0, VISIT_TYPE_MAX_LENGTH))
          .filter(Boolean),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card template-card">
      <h2 className="section-title">Dati dello studio</h2>
      <form className="form" onSubmit={save}>
        <label>
          Nome dello studio (compare nei messaggi ai pazienti)
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </label>
        <label>
          Tipi di appuntamento proposti — uno per riga
          <textarea
            rows={5}
            value={types}
            onChange={(e) => setTypes(e.target.value)}
            placeholder={'Controllo\nPrima visita\nMedicazione'}
          />
        </label>
        <p className="privacy-note">
          🔒 Usa etichette generiche, massimo {VISIT_TYPE_MAX_LENGTH} caratteri. Non inserire diagnosi,
          patologie o altre informazioni cliniche: nel sistema non devono mai entrare dati sanitari.
        </p>

        <h3 className="subsection-title">Orari di silenzio</h3>
        <p className="muted small-note">
          In questa fascia non viene inviato nessun messaggio. Un promemoria che cadrebbe qui dentro
          non viene perso: parte alla prima ora utile.
        </p>
        <div className="form-row">
          <label>
            Dalle
            <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} required />
          </label>
          <label>
            Alle
            <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} required />
          </label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="template-foot">
          <button className="btn primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </button>
          {saved && <span className="pill pill-ok">✓ Salvato</span>}
        </div>
      </form>
    </div>
  );
}

function WhatsappSection() {
  const [settings, setSettings] = useState<WhatsappSettingsDto | null>(null);
  const [phone, setPhone] = useState('');
  const [channelId, setChannelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const s = await get<WhatsappSettingsDto>('/whatsapp/settings');
    setSettings(s);
    setPhone(s.phone ?? '');
    setChannelId(s.channelId ?? '');
  };

  useEffect(() => {
    load().catch((err) => setError(String(err)));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const s = await put<WhatsappSettingsDto>('/whatsapp/settings', {
        phone: phone || null,
        channelId: channelId || null,
        ...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
      });
      setSettings(s);
      setApiKey('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!settings) return;
    setError(null);
    try {
      const s = await put<WhatsappSettingsDto>('/whatsapp/settings', { active: !settings.active });
      setSettings(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    }
  };

  const sendTest = async () => {
    setTestResult(null);
    setError(null);
    try {
      const r = await post<{ ok: boolean; provider?: string; error?: string }>('/whatsapp/test', {
        phone: testPhone,
      });
      setTestResult(
        r.ok
          ? `✅ Messaggio di prova inviato (canale: ${r.provider === 'mock' ? 'demo — vedi log' : r.provider})`
          : `❌ Invio non riuscito: ${r.error}`,
      );
      await load();
    } catch (err) {
      setTestResult(`❌ ${err instanceof Error ? err.message : 'Errore imprevisto'}`);
    }
  };

  if (!settings) return <p className="muted">Caricamento…</p>;

  const statusPill = settings.active ? (
    <span className="pill pill-ok">✓ Canale attivo</span>
  ) : settings.apiKeyConfigured ? (
    <span className="pill pill-warn">Configurato ma non attivo</span>
  ) : (
    <span className="pill pill-off">Non configurato</span>
  );

  return (
    <div className="card template-card">
      <div className="section-head">
        <h2 className="section-title">Canale WhatsApp dello studio</h2>
        {statusPill}
      </div>
      <p className="muted small-note">
        Ogni studio usa il proprio numero e il proprio account 360dialog. La procedura completa è in{' '}
        <code>docs/whatsapp-setup.md</code>. Senza canale attivo il sistema resta in modalità demo.
      </p>
      <form className="form" onSubmit={save}>
        <div className="form-row">
          <label>
            Numero mittente WhatsApp
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="es. +39 06 1234567" />
          </label>
          <label>
            ID canale 360dialog
            <input value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="es. abcdEFGH" />
          </label>
        </div>
        <label>
          API key del canale{' '}
          {settings.apiKeyConfigured && settings.apiKeyLast4 && (
            <span className="muted">(salvata: ••••{settings.apiKeyLast4})</span>
          )}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.apiKeyConfigured ? 'Lascia vuoto per non cambiarla' : 'Incolla qui la API key'}
            autoComplete="new-password"
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="template-foot">
          <button className="btn primary" disabled={busy}>
            Salva impostazioni
          </button>
          {saved && <span className="pill pill-ok">✓ Salvato</span>}
          {settings.apiKeyConfigured && (
            <button type="button" className={`btn ${settings.active ? 'danger-outline' : 'ok'}`} onClick={toggleActive}>
              {settings.active ? 'Disattiva canale' : 'Attiva canale'}
            </button>
          )}
        </div>
      </form>

      {settings.webhookUrl && (
        <div className="webhook-box">
          <strong>URL webhook da incollare nel pannello 360dialog:</strong>
          <div className="webhook-row">
            <code className="webhook-url">{settings.webhookUrl}</code>
            <button
              type="button"
              className="btn small"
              onClick={async () => {
                await navigator.clipboard.writeText(settings.webhookUrl!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? '✓ Copiato' : 'Copia'}
            </button>
          </div>
        </div>
      )}

      <div className="test-box">
        <strong>Invia messaggio di prova</strong>
        <p className="muted small-note">Manda il promemoria 48 ore con dati di esempio al numero indicato.</p>
        <div className="form-row">
          <input
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="es. 333 1234567"
          />
          <button type="button" className="btn" onClick={sendTest} disabled={!testPhone}>
            Invia prova
          </button>
        </div>
        {testResult && <p className="small-note">{testResult}</p>}
        {settings.lastTest && !testResult && (
          <p className="muted small-note">
            Ultimo test: {new Date(settings.lastTest.at).toLocaleString('it-IT')} —{' '}
            {settings.lastTest.ok ? 'riuscito ✅' : `fallito (${settings.lastTest.error})`}
          </p>
        )}
      </div>
    </div>
  );
}

/** Cambio della password di accesso allo studio. */
function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== repeat) {
      setError('Le due nuove password non coincidono.');
      return;
    }
    setBusy(true);
    try {
      await post('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setRepeat('');
      setDone(true);
      setTimeout(() => setDone(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card template-card">
      <h2 className="section-title">Password di accesso</h2>
      <form className="form" onSubmit={submit}>
        <label>
          Password attuale
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <div className="form-row">
          <label>
            Nuova password (almeno {MIN_PASSWORD_LENGTH} caratteri)
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            Ripeti la nuova password
            <input
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              required
            />
          </label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="template-foot">
          <button className="btn primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Cambia password'}
          </button>
          {done && <span className="pill pill-ok">✓ Password aggiornata</span>}
        </div>
      </form>
    </div>
  );
}

function TemplatesSection() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [saved, setSaved] = useState<TemplateKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<TemplateRow[]>('/templates').then(setTemplates).catch((err) => setError(String(err)));
  }, []);

  const save = async (kind: TemplateKind, body: string) => {
    setError(null);
    try {
      await put(`/templates/${kind}`, { body });
      setSaved(kind);
      setTimeout(() => setSaved(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    }
  };

  return (
    <div>
      <h2 className="page-title">Testi dei messaggi</h2>
      <p className="muted">
        Puoi usare queste parole speciali, verranno sostituite automaticamente:{' '}
        {TEMPLATE_VARIABLES.map((v) => (
          <code key={v} className="var-chip">{`{{${v}}}`}</code>
        ))}
      </p>
      <p className="muted small-note">
        ⚠️ Con il canale WhatsApp reale attivo, il testo dei due promemoria è quello approvato da Meta:
        queste versioni valgono per la modalità demo. Il messaggio di ringraziamento è invece sempre libero.
      </p>
      <p className="privacy-note">
        🔒 Il tipo di appuntamento non è disponibile tra le variabili, ed è una scelta voluta: comparirebbe
        nell'anteprima della notifica sul telefono del paziente, dove può leggerlo chiunque abbia il
        dispositivo in mano. Il messaggio dice solo studio, data e ora.
      </p>
      {error && <p className="error-text">{error}</p>}
      {templates.map((t, i) => (
        <div className="card template-card" key={t.kind}>
          <h2 className="section-title">{REMINDER_KIND_LABELS[t.kind]}</h2>
          <textarea
            rows={4}
            value={t.body}
            onChange={(e) =>
              setTemplates((prev) => prev.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))
            }
          />
          <div className="template-foot">
            <button className="btn primary" onClick={() => save(t.kind, t.body)}>
              Salva
            </button>
            {saved === t.kind && <span className="pill pill-ok">✓ Salvato</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
