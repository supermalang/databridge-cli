import { useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import FileTable from '../components/FileTable.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Templates() {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const [files, setFiles] = useState(null);
  const [active, setActive] = useState('');

  const load = useCallback(async () => {
    try {
      const [data, activeData] = await Promise.all([
        fetch('/api/templates').then(r => r.json()),
        fetch('/api/templates/active').then(r => r.json()),
      ]);
      setFiles(data.files || []);
      setActive(activeData.active || '');
    } catch (e) { toast(String(e), 'err'); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/templates/upload', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    toast(res.ok ? `Uploaded ${data.name || file.name}` : (data.detail || 'Upload failed'), res.ok ? 'ok' : 'err');
    e.target.value = ''; // reset so re-upload of same file works
    load();
  };

  const setActiveTemplate = async (name) => {
    const res = await fetch(`/api/templates/set-active/${encodeURIComponent(name)}`, { method: 'POST' });
    toast(res.ok ? `Active template: ${name}` : 'Failed to set active', res.ok ? 'ok' : 'err');
    load();
  };

  const deleteTemplate = async (name) => {
    if (!confirm(`Delete ${name}?`)) return;
    const res = await fetch(`/api/templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
    toast(res.ok ? `Deleted ${name}` : 'Delete failed', res.ok ? 'ok' : 'err');
    load();
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Settings · Templates"
        title="Word"
        accent="templates."
        sub="Manage the .docx templates used by build-report. Each placeholder ({{ chart_x }}, {{ ind_y }}) gets filled at render time."
      />
      <div style={{ padding: '0 28px 40px' }}>
        <div className="form-section">
          <div className="form-section-title">
            Templates
            <span>{files?.length ?? 0} on disk</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={load}>↺ Refresh</button>
              <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
                ↑ Upload .docx
                <input
                  ref={fileInputRef}
                  type="file" accept=".docx"
                  style={{ display: 'none' }}
                  onChange={upload}
                />
              </label>
            </div>
          </div>

          {files === null && <p className="empty-state" style={{ padding: 12 }}>Loading…</p>}
          {files?.length === 0 && (
            <p className="empty-state" style={{ padding: 16 }}>
              No templates yet — run <b>generate-template</b> from the Dashboard or upload a <code style={{ fontFamily: 'var(--font-mono)' }}>.docx</code>.
            </p>
          )}
          {files?.length > 0 && (
            <FileTable
              columns={[
                { key: 'name', label: 'File', render: f => (
                  <>
                    <span className="file-name">{f.name}</span>
                    {f.name === active && <span className="badge-active">Active</span>}
                  </>
                )},
                { key: 'size_kb', label: 'Size', render: f => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{f.size_kb} KB</span> },
                { key: 'modified', label: 'Modified', render: f => <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{f.modified}</span> },
              ]}
              rows={files}
              actions={f => (
                <>
                  {f.name === active ? (
                    <button className="btn btn-ghost btn-sm" disabled style={{ opacity: 0.5 }}>✓ Active</button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => setActiveTemplate(f.name)}>Set as active</button>
                  )}
                  <a href={`/api/templates/download/${encodeURIComponent(f.name)}`} download>
                    <button className="btn btn-primary btn-sm">↓ Download</button>
                  </a>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteTemplate(f.name)}>Delete</button>
                </>
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
