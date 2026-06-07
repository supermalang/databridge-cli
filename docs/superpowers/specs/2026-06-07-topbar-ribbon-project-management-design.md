# Top ribbon rearrange + project management — Design

Date: 2026-06-07
Branch: feat/extract-config-and-rail

## Goal

Tidy the top ribbon and turn project management into a first-class flow:

1. Remove the Notifications button.
2. Replace the logout button with a circular user-initials avatar that opens a
   dropdown (profile + sign out). Let the user edit their profile, propagated to
   Zitadel when configured.
3. Improve the project dropdown:
   - Fix unreadable text (white-on-white contrast bug).
   - "+ New project" opens a full-screen multi-tab **page** (not a modal) to create
     a project — name, description, tags, default language, color/icon, and invite
     members with roles.
   - On the active-project row, a settings gear opens the same form in edit mode,
     where the project can also be archived or deleted.

## Architectural decisions

### Project form is a full-screen overlay, not a route
The app is a tab SPA with **no router** (`App.jsx` owns stage/sub state). The project
create/edit form renders as a full-screen overlay inside `App.jsx`, toggled by a single
state value `projectForm = null | 'create' | { edit: project }`. While open it replaces
the tab-content area and has its own back/close. No router dependency is added.

### Project metadata storage
Add a `meta` JSON column (holds `description`, `tags`, `language`, `color`, `icon`) and a
real `archived_at` timestamp column to the `Project` model, via one Alembic migration.
`archived_at` is a real column so queries can filter archived projects. Metadata is kept
**out** of the existing `config` jsonb, which mirrors to `config.yml` for the CLI and must
stay survey-config-only.

### Profile editing
Identity lives in Zitadel. We edit First/Last name locally and push to Zitadel when the
Management API is configured (`zitadel_admin.enabled()`), otherwise update only our DB
`User.name`. Email stays read-only (Zitadel-owned).

## Components & changes

### Backend

**`web/db/models.py` — `Project`**
- `meta: Mapped[dict]` — `JSON().with_variant(JSONB, "postgresql")`, default `dict`.
- `archived_at: Mapped[datetime | None]` — nullable.

**Alembic migration** (`web/db/migrations/versions/…`)
- Add both columns. Must also be created by the test path (`init_schema` / SQLite); since
  tests build schema from the models via `init_schema`, the new mapped columns appear
  automatically there — the migration covers the Postgres path.

**`web/db/repository.py`**
- `create_project(...)` extended to accept optional `meta` dict.
- `update_project(db, project, *, name=None, meta=None)` — partial update.
- `archive_project(db, project, archived: bool)` — set/clear `archived_at`.
- `list_projects_for_user` keeps returning archived projects (frontend groups them).

**`web/zitadel_admin.py`**
- `update_human_user(user_id, given, family)` → `PUT /v2/users/human/{userId}` with
  `{"profile": {"givenName", "familyName"}}`. Raises `ZitadelAdminError` on failure.

**`web/main.py`**
- `POST /api/projects` (NewProjectPayload): accept `description`, `tags`, `language`,
  `color`, `icon`; pack into `meta`.
- `PATCH /api/projects/{id}` (admin via `_admin_project`): update name + meta.
- `POST /api/projects/{id}/archive` and `/unarchive` (admin): toggle `archived_at`.
- `GET /api/projects`: include `description`, `tags`, `language`, `color`, `icon`,
  `is_archived` per project.
- `PATCH /api/me`: body `{ given_name, family_name }`; update DB `User.name`
  (`"given family"`); if `zitadel_admin.enabled()` and not dev-local, call
  `update_human_user`. Returns the refreshed user dict. Self-service (any authenticated
  user edits their own profile).

RBAC: settings edit / archive / delete = **admin** (matches existing manage + delete
gating). Profile = self.

### Frontend

**`frontend/src/lib/projects.js`**
- `createProject(payload)` — accept the full object, not just a name.
- `updateProject(id, patch)`, `archiveProject(id, archived)`.

**`frontend/src/lib/auth.js`**
- `updateProfile({ given_name, family_name })` → `PATCH /api/me`.

**`frontend/src/components/UserMenu.jsx`** (new)
- Circular initials avatar trigger; dropdown with name + email + role/superadmin badges,
  a **Profile** item (opens `ProfileModal`), and **Sign out** (form POST to
  `/auth/logout` for real users; omitted for dev-local). Click-outside closes.

**`frontend/src/components/ProfileModal.jsx`** (new)
- Edit First/Last name; email read-only; role badge. Save → `updateProfile`, toast,
  refresh `me`.

**`frontend/src/pages/ProjectForm.jsx`** (new) — multi-tab full-screen
- **Details:** name (required), description, tags, default language, color + icon.
  Create mode primary action **Create** → on success flip to edit mode.
- **Members:** reuse the invite/roster logic from `ProjectMembersModal` (extract the
  inner panel into a shared piece, or render equivalent inline). Disabled in create mode
  until the project exists.
- **Danger zone** (edit mode, admin only): **Archive** (recoverable) and **Delete**
  (permanent; existing confirm flow).

**`frontend/src/App.jsx`**
- Remove the Notifications button.
- Replace the logout block with `<UserMenu me={me} role={activeRole} isSuperadmin=… />`.
- Project menu: remove the inline "Delete" item; add a settings gear on the active-project
  row → `setProjectForm({ edit: activeProject })`. "+ New project" → `setProjectForm('create')`.
- Render `<ProjectForm />` overlay when `projectForm` is set; refresh projects on close.
- Archived projects render in a greyed "Archived" group in the switcher with Unarchive.

**`frontend/src/styles.css`**
- `.project-menu` (and items): explicit `color: var(--ink)`; readable hover/active/role/
  danger colors. Fixes white-on-white.
- Circular avatar style for the user menu; user-menu dropdown styles.
- ProjectForm layout (tab strip, panels, danger zone) and the switcher archived group.

## Testing

Backend pytest (SQLite):
- create project with metadata → persisted in `meta`.
- `PATCH /api/projects/{id}` updates name + meta; editor gets 403, admin succeeds.
- archive/unarchive toggles `archived_at`; reflected in `GET /api/projects` `is_archived`;
  admin-gated.
- `PATCH /api/me` (Zitadel disabled) updates DB name and returns it.

Frontend: manual verification via `./scripts/serve.sh` — avatar menu, profile edit,
project create page, settings edit, archive/delete, dropdown contrast.

## Out of scope
- Editing email (Zitadel-owned).
- Notifications system (button removed, not replaced).
- Tag-based filtering of the project list beyond the archived/active split.
