import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useFieldErrors } from '../lib/fieldError.js';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard.js';
import { useToast } from '../components/Toast.jsx';
import ProjectMembersPanel from '../components/ProjectMembersPanel.jsx';
import { createProject, updateProject, archiveProject } from '../lib/projects.js';
import { deleteProject as apiDeleteProject } from '../lib/members.js';
import { tabProps, panelProps, makeTabKeydown } from '../lib/tabs.js';

const LANGS = ['English', 'French', 'Spanish', 'Portuguese', 'Arabic'];
const COLORS = ['#0EA5E9', '#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#64748B'];
const ICONS = ['📊', '🩺', '🌍', '🎓', '🚰', '🌱', '🏥', '📦'];

// Human-readable names parallel to COLORS / ICONS, used as accessible labels so
// the swatch and icon pickers don't convey their meaning by color/emoji alone
// (the emoji glyph also renders as tofu without an emoji font). Index-aligned.
const COLOR_NAMES = ['Sky', 'Indigo', 'Emerald', 'Amber', 'Red', 'Violet', 'Teal', 'Slate'];
const ICON_NAMES = ['Chart', 'Health', 'Globe', 'Education', 'Water', 'Plant', 'Hospital', 'Package'];

// Full-screen create/edit project form. `mode` is 'create' or an existing project
// object (edit). Calls onDone(projectId|null) when finished/closed; onChanged() to
// ask the parent to refresh its project list.
export default function ProjectForm({ mode, canAdmin, initialTab, onDone, onChanged }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const editing = mode !== 'create';
  const [proj, setProj] = useState(editing ? mode : null);   // becomes set after create
  const [tab, setTab] = useState(initialTab || 'details');

  const fe = useFieldErrors();
  const init = editing ? mode : {};
  const [name, setName] = useState(init.name || '');

  // Inline required-name validation (A11Y-5 fieldProps pattern: aria-invalid +
  // aria-describedby + role="alert"). Keep the error in sync with the live value
  // so the empty input is announced and the submit button stays gated.
  const setNameAndValidate = (value) => {
    setName(value);
    if (value.trim()) fe.clearError('name');
    else fe.setError('name', 'Name is required');
  };
  // Seed the error for an empty initial name (create mode) on first render.
  if (!name.trim() && !fe.errorFor('name')) fe.setError('name', 'Name is required');
  // React's useId yields colon-bearing ids (":r5:") that are invalid in a CSS
  // `#id` selector; sanitize so aria-describedby resolves and is queryable.
  const nameErrorId = fe.errorId('name').replace(/:/g, '-');
  const [description, setDescription] = useState(init.description || '');
  const [tagsText, setTagsText] = useState((init.tags || []).join(', '));
  const [language, setLanguage] = useState(init.language || 'English');
  const [color, setColor] = useState(init.color || COLORS[0]);
  const [icon, setIcon] = useState(init.icon || ICONS[0]);
  const [busy, setBusy] = useState(false);

  const tags = () => tagsText.split(',').map(t => t.trim()).filter(Boolean);
  const payload = () => ({ name: name.trim(), description, tags: tags(), language, color, icon });

  // Snapshot of the last-saved (or initial) Details values, used for dirty
  // tracking. Refreshed on a successful create/save so saving clears the guard.
  const [baseline, setBaseline] = useState(() => ({
    name: init.name || '',
    description: init.description || '',
    tagsText: (init.tags || []).join(', '),
    language: init.language || 'English',
    color: init.color || COLORS[0],
    icon: init.icon || ICONS[0],
  }));

  const dirty =
    name !== baseline.name ||
    description !== baseline.description ||
    tagsText !== baseline.tagsText ||
    language !== baseline.language ||
    color !== baseline.color ||
    icon !== baseline.icon;
  useUnsavedGuard(!!dirty);

  const submit = async () => {
    if (!name.trim()) { toast('Name is required', 'err'); return; }
    setBusy(true);
    try {
      if (!proj) {
        const created = await createProject(payload());
        setProj({ ...created, ...payload() });
        onChanged?.();
        toast(`Project “${name}” created`, 'ok');
        setTab('members');   // create-first, then invite
      } else {
        await updateProject(proj.id, payload());
        onChanged?.();
        toast('Saved', 'ok');
      }
      setBaseline({ name, description, tagsText, language, color, icon });
    } catch (e) { toast(e.message || 'Save failed', 'err'); }
    finally { setBusy(false); }
  };

  // Back: if there are unsaved Details edits, confirm before discarding —
  // reusing the shared useConfirm() Modal (same guard as project switching).
  const handleBack = async () => {
    if (dirty && !await confirm({
      title: 'Discard unsaved changes?',
      message: 'You have unsaved edits to this project. Leaving will discard them.',
      confirmLabel: 'Discard',
    })) return;
    onDone?.(proj?.id || null);
  };

  const doArchive = async (archived) => {
    if (!await confirm({
      title: archived ? 'Archive project?' : 'Restore project?',
      message: archived
        ? `“${proj.name}” will be hidden from the active list. You can restore it later.`
        : `“${proj.name}” will be active again.`,
      confirmLabel: archived ? 'Archive' : 'Restore',
    })) return;
    try { await archiveProject(proj.id, archived); onChanged?.(); toast(archived ? 'Archived' : 'Restored', 'ok'); onDone?.(proj.id); }
    catch (e) { toast(e.message || 'Failed', 'err'); }
  };

  const doDelete = async () => {
    if (!await confirm({
      title: 'Delete project?',
      message: `“${proj.name}” and all of its data, reports and members will be permanently deleted. This can’t be undone.`,
      confirmLabel: 'Delete project',
    })) return;
    try { await apiDeleteProject(proj.id); onChanged?.(); toast(`Deleted “${proj.name}”`, 'ok'); onDone?.(null); }
    catch (e) { toast(e.message || 'Delete failed', 'err'); }
  };

  const membersDisabled = !proj;   // create mode before first save
  // Ordered ids of the tabs that are actually navigable (disabled Members is
  // skipped in the roving order), used by the arrow-key handler.
  const pfTabIds = [
    'details',
    ...(membersDisabled ? [] : ['members']),
    ...(editing && canAdmin ? ['danger'] : []),
  ];

  return (
    <div className="project-form">
      <div className="project-form__bar">
        <button className="btn btn-sm" onClick={handleBack}>← Back</button>
        <h2 className="project-form__title">
          {editing ? `Project settings · ${proj?.name}` : 'New project'}
        </h2>
      </div>

      <div
        className="project-form__tabs"
        role="tablist"
        aria-label={t('projectForm.sectionsAria')}
        data-tab-group="projectform"
        onKeyDown={makeTabKeydown('projectform', pfTabIds, tab, setTab)}
      >
        <button type="button" className={`pf-tab ${tab === 'details' ? 'active' : ''}`}
                {...tabProps('projectform', 'details', tab === 'details')}
                onClick={() => setTab('details')}>{t('projectForm.tabDetails')}</button>
        <button type="button"
                className={`pf-tab ${tab === 'members' ? 'active' : ''} ${membersDisabled ? 'disabled' : ''}`}
                {...tabProps('projectform', 'members', tab === 'members')}
                aria-disabled={membersDisabled ? 'true' : undefined}
                onClick={() => !membersDisabled && setTab('members')}
                title={membersDisabled ? 'Create the project first' : ''}>{t('projectForm.tabMembers')}</button>
        {editing && canAdmin && (
          <button type="button" className={`pf-tab ${tab === 'danger' ? 'active' : ''}`}
                  {...tabProps('projectform', 'danger', tab === 'danger')}
                  onClick={() => setTab('danger')}>{t('projectForm.tabDanger')}</button>
        )}
      </div>

      <div className="project-form__body">
        {tab === 'details' && (
          <div className="pf-panel" {...panelProps('projectform', 'details')}>
            <div className="profile-field"><label>{t('projectForm.name')}</label>
              <input autoFocus value={name}
                     aria-invalid={fe.errorFor('name') ? 'true' : 'false'}
                     aria-describedby={fe.errorFor('name') ? nameErrorId : undefined}
                     onChange={e => setNameAndValidate(e.target.value)} placeholder={t('projectForm.namePlaceholder')} />
              {fe.errorFor('name') && (
                <div id={nameErrorId} role="alert" className="pf-field-error">{fe.errorFor('name')}</div>
              )}</div>
            <div className="profile-field"><label>{t('projectForm.description')}</label>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
                        placeholder={t('projectForm.descriptionPlaceholder')} /></div>
            <div className="profile-field"><label>{t('projectForm.tags')}</label>
              <input value={tagsText} onChange={e => setTagsText(e.target.value)} placeholder={t('projectForm.tagsPlaceholder')} /></div>
            <div className="profile-field"><label htmlFor="pf-language">{t('projectForm.defaultLanguage')}</label>
              {editing ? (
                <>
                  <select id="pf-language" className="pf-readonly-select" value={language}
                          aria-disabled="true" aria-describedby="pf-language-note"
                          style={{ background: 'var(--bg-2)', color: 'var(--ink-2)', cursor: 'not-allowed' }}
                          onMouseDown={e => e.preventDefault()}
                          onKeyDown={e => { if (e.key !== 'Tab') e.preventDefault(); }}
                          onChange={() => {}}>
                    {LANGS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <div id="pf-language-note" className="pf-field-note"
                       style={{ color: 'var(--ink-3)', fontSize: 11.5, marginTop: 6, lineHeight: 1.45 }}>
                    {t('projectForm.languageNote')}
                  </div>
                </>
              ) : (
                <select id="pf-language" value={language} onChange={e => setLanguage(e.target.value)}>
                  {LANGS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              )}</div>
            <div className="profile-field"><label>{t('projectForm.color')}</label>
              <div className="pf-swatches">
                {COLORS.map((c, i) => (
                  <button key={c} type="button" className={`pf-swatch ${color === c ? 'sel' : ''}`}
                          aria-label={COLOR_NAMES[i]} aria-pressed={color === c ? 'true' : 'false'}
                          style={{ background: c }} onClick={() => setColor(c)} />
                ))}
              </div></div>
            <div className="profile-field"><label>{t('projectForm.icon')}</label>
              <div className="pf-icons">
                {ICONS.map((ic, i) => (
                  <button key={ic} type="button" className={`pf-icon ${icon === ic ? 'sel' : ''}`}
                          aria-label={ICON_NAMES[i]} aria-pressed={icon === ic ? 'true' : 'false'}
                          onClick={() => setIcon(ic)}>{ic}</button>
                ))}
              </div></div>
            <div className="pf-actions">
              <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={submit}>
                {busy ? 'Saving…' : (proj ? 'Save' : 'Create')}
              </button>
            </div>
          </div>
        )}

        {tab === 'members' && proj && (
          <div className="pf-panel" {...panelProps('projectform', 'members')}><ProjectMembersPanel project={proj} /></div>
        )}

        {tab === 'danger' && editing && canAdmin && (
          <div className="pf-panel" {...panelProps('projectform', 'danger')}>
            <div className="pf-danger">
              <div>
                <div className="pf-danger__title">{proj.is_archived ? 'Restore project' : 'Archive project'}</div>
                <div className="pf-danger__desc">
                  {proj.is_archived ? 'Make this project active again.'
                                    : 'Hide from the active list. Recoverable later.'}
                </div>
              </div>
              <button className="btn" onClick={() => doArchive(!proj.is_archived)}>
                {proj.is_archived ? 'Restore' : 'Archive'}
              </button>
            </div>
            <div className="pf-danger">
              <div>
                <div className="pf-danger__title">{t('projectForm.deleteTitle')}</div>
                <div className="pf-danger__desc">{t('projectForm.deleteDesc')}</div>
              </div>
              <button className="btn btn-danger" onClick={doDelete}>{t('projectForm.deleteButton')}</button>
            </div>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
