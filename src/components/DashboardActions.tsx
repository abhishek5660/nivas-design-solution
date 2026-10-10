'use client';
import { useState } from 'react';
import { NewProjectDialog } from './ProjectsView';

export function DashboardActions({ canCreate }: { canCreate: boolean }) {
  const [open, setOpen] = useState(false);
  if (!canCreate) return <span className="chip">View-only account</span>;
  return (
    <>
      <button className="btn btn-gold" onClick={() => setOpen(true)}>+ New project</button>
      {open && <NewProjectDialog onClose={() => setOpen(false)} />}
    </>
  );
}
