import Modal from './Modal.jsx';
import ProjectMembersPanel from './ProjectMembersPanel.jsx';

// Manage members of a single project in a modal (used from the project switcher).
export default function ProjectMembersModal({ project, onClose }) {
  return (
    <Modal title={`Members · ${project.name}`} onClose={onClose} width={560}>
      <ProjectMembersPanel project={project} />
    </Modal>
  );
}
