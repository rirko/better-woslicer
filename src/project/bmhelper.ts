import { z } from 'zod';
import type { BmhProject } from '../core/bmh';
import type { DivNote } from '../core/bmhelper';

const i32 = z.int().min(-0x80000000).max(0x7fffffff);
const index = z.int().min(0).max(0x7fffffff);
const quantize = z.int().min(1).max(0x7fffffff);
const note = z.object({ position: i32, gate: i32, nn: i32, vel: i32 });
const parameter = z.object({ position: i32, value: i32 });
const sequence = z.object({
  quantize,
  notes: z.array(note),
  pitches: z.array(parameter),
  controls: z.array(parameter.extend({ cc: i32 })),
});
const division = z.object({
  // DX text is Unicode. Only the legacy BMH export applies CP932 restrictions.
  name: z.string().refine((name) => !/[\uD800-\uDFFF]/u.test(name), {
    error: 'name contains an unpaired Unicode surrogate',
  }),
  quantize,
  recording: z.array(note),
  definitions: z.array(z.object({ zz: z.int().min(0).max(1295), div: index })),
  src2def: z.array(index),
  zzDefinition: z.boolean(),
});

/** UTF-8 JSON storage for DX; derived note referrers are rebuilt on load. */
export const bmhelperDocumentSchema = z
  .object({
    format: z.literal('bmhelper'),
    source: sequence,
    divisions: z.array(division),
  })
  .superRefine((project, context) => {
    project.divisions.forEach((entry, at) => {
      if (
        entry.src2def.length !== project.source.notes.length ||
        entry.src2def.some((value) => value >= entry.definitions.length)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['divisions', at, 'src2def'],
          message: 'invalid source-to-definition mapping',
        });
      }
      if (entry.definitions.some((value) => value.div >= entry.recording.length)) {
        context.addIssue({
          code: 'custom',
          path: ['divisions', at, 'definitions'],
          message: 'definition references a missing recording note',
        });
      }
    });
  });

export type BmhelperDocument = z.infer<typeof bmhelperDocumentSchema>;

export function bmhelperToDocument(project: BmhProject): BmhelperDocument {
  // Schema parsing validates and copies the draft, and removes derived notes.
  return bmhelperDocumentSchema.parse({ format: 'bmhelper', ...project });
}

export function bmhelperFromDocument(document: BmhelperDocument): BmhProject {
  return {
    source: document.source,
    divisions: document.divisions.map((entry) => {
      const notes: DivNote[] = entry.recording.map((note) => ({
        nn: note.nn,
        gate: note.gate,
        vel: note.vel,
        recPos: note.position,
        referrers: [],
      }));
      entry.src2def.forEach((definition, source) => {
        notes[entry.definitions[definition].div].referrers.push(source);
      });
      return { ...entry, notes };
    }),
  };
}
