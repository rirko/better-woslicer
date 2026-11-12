import { parseProject, ProjectFormatError } from './codec';
import type { ProjectDocument, ProjectFileV1 } from './schema';

const HISTORY_LIMIT = 200;

export interface ProjectTransactionResult<T> {
  changed: boolean;
  value: T;
  revision: number;
}

export interface ProjectDraft {
  readonly baseRevision: number;
  readonly document: ProjectFileV1;
}

function clone(document: ProjectDocument): ProjectFileV1 {
  const parsed = parseProject(document);
  if (parsed.kind !== 'supported') throw new ProjectFormatError('cannot clone an unsupported project version');
  return parsed.project;
}

function equal(left: ProjectDocument, right: ProjectDocument): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function freeze(document: ProjectFileV1): ProjectDocument {
  function visit(value: unknown): void {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) visit(child);
    Object.freeze(value);
  }
  visit(document);
  return document;
}

/** Owns the one editable ProjectDocument and its bounded transaction history. */
export class ProjectEditor {
  private documentValue: ProjectDocument;
  private savedValue: ProjectDocument;
  private undoHistory: ProjectDocument[] = [];
  private redoHistory: ProjectDocument[] = [];
  private revisionValue = 0;
  private savedRevisionValue = 0;

  constructor(document: ProjectDocument) {
    const parsed = parseProject(document);
    if (parsed.kind !== 'supported') throw new ProjectFormatError('cannot edit an unsupported project version');
    this.documentValue = freeze(parsed.project);
    this.savedValue = this.documentValue;
  }

  get document(): ProjectDocument { return this.documentValue; }
  get revision(): number { return this.revisionValue; }
  get savedRevision(): number { return this.savedRevisionValue; }
  get isDirty(): boolean { return !equal(this.documentValue, this.savedValue); }
  get canUndo(): boolean { return this.undoHistory.length > 0; }
  get canRedo(): boolean { return this.redoHistory.length > 0; }

  transact<T>(edit: (draft: ProjectFileV1) => T): ProjectTransactionResult<T> {
    const before = this.documentValue;
    const draft = clone(before);
    const value = edit(draft);
    const parsed = parseProject(draft);
    if (parsed.kind !== 'supported') throw new ProjectFormatError('cannot commit an unsupported project version');
    if (equal(before, parsed.project)) return { changed: false, value, revision: this.revisionValue };
    this.undoHistory.push(before);
    if (this.undoHistory.length > HISTORY_LIMIT) this.undoHistory.shift();
    this.redoHistory = [];
    this.documentValue = freeze(parsed.project);
    this.revisionValue++;
    return { changed: true, value, revision: this.revisionValue };
  }

  beginDraft(): ProjectDraft {
    return { baseRevision: this.revisionValue, document: clone(this.documentValue) };
  }

  updateDraft(draft: ProjectDraft, edit: (value: ProjectFileV1) => void): void {
    if (draft.baseRevision !== this.revisionValue) throw new ProjectFormatError('project changed during the edit gesture');
    const next = clone(draft.document);
    edit(next);
    const parsed = parseProject(next);
    if (parsed.kind !== 'supported') throw new ProjectFormatError('draft has an unsupported project version');
    Object.assign(draft.document, parsed.project);
  }

  commitDraft(draft: ProjectDraft): ProjectTransactionResult<void> {
    if (draft.baseRevision !== this.revisionValue) throw new ProjectFormatError('project changed during the edit gesture');
    return this.transact(next => { Object.assign(next, clone(draft.document)); });
  }

  undo(): boolean {
    const previous = this.undoHistory.pop();
    if (!previous) return false;
    this.redoHistory.push(this.documentValue);
    this.documentValue = previous;
    this.revisionValue++;
    return true;
  }

  redo(): boolean {
    const next = this.redoHistory.pop();
    if (!next) return false;
    this.undoHistory.push(this.documentValue);
    this.documentValue = next;
    this.revisionValue++;
    return true;
  }

  markSaved(revision: number): boolean {
    if (revision !== this.revisionValue) return false;
    this.savedValue = this.documentValue;
    this.savedRevisionValue = revision;
    return true;
  }

  replace(document: ProjectDocument, options: { saved?: boolean } = {}): void {
    const parsed = parseProject(document);
    if (parsed.kind !== 'supported') throw new ProjectFormatError('cannot open an unsupported project version');
    this.documentValue = freeze(parsed.project);
    if (options.saved !== false) this.savedValue = this.documentValue;
    this.undoHistory = [];
    this.redoHistory = [];
    this.revisionValue++;
    if (options.saved !== false) this.savedRevisionValue = this.revisionValue;
  }
}
