import { parseProject, ProjectFormatError, projectCapability } from '../project/codec';
import type { MediaAsset, ProjectDocument, ProjectFileV1 } from '../project/schema';
import type { OpenedFile } from '../platform/contracts';
import type { DecodedAudio } from '../audio/audio-jobs';

/** Portable metadata never includes a host grant. Hints never authorize file access. */
export async function identifyAudio(file: OpenedFile) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'wav' && extension !== 'ogg')
    throw new ProjectFormatError('Unsupported audio extension');
  const format: MediaAsset['format'] = extension;
  const byteLength = file.bytes.byteLength;
  // Hash before transferring the original buffer to the decoding worker.
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(file.bytes));
  const integrity: NonNullable<MediaAsset['integrity']> = {
    algorithm: 'sha256',
    digest: Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join(
      '',
    ),
  };
  return { format, byteLength, integrity };
}
export function activeMedia(document: ProjectDocument): ProjectDocument['media'][number] | null {
  const capability = projectCapability(document);
  return capability.kind === 'single-track'
    ? (document.media.find((media) => media.mediaId === capability.mediaId) ?? null)
    : null;
}
export function verifyAudio(
  asset: ProjectDocument['media'][number],
  identity: Awaited<ReturnType<typeof identifyAudio>>,
  decoded: DecodedAudio,
): void {
  const { source } = decoded;
  if (
    asset.format !== identity.format ||
    (asset.byteLength !== null && asset.byteLength !== identity.byteLength) ||
    (asset.sampleRateHz !== null && asset.sampleRateHz !== source.sampleRate) ||
    (asset.channels !== null && asset.channels !== source.channels) ||
    (asset.framesPerChannel !== null && asset.framesPerChannel !== source.length) ||
    (asset.integrity !== null && asset.integrity.digest !== identity.integrity.digest)
  ) {
    throw new ProjectFormatError('Selected audio does not match the project media');
  }
}
export function projectWithAudio(
  document: ProjectDocument,
  file: OpenedFile,
  identity: Awaited<ReturnType<typeof identifyAudio>>,
  decoded: DecodedAudio,
  preserveBaseName: boolean,
): ProjectFileV1 {
  const parsed = parseProject(document);
  if (parsed.kind !== 'supported' || parsed.capability.kind === 'unsupported-arrangement')
    throw new ProjectFormatError('This arrangement cannot be edited in the single-track workspace');
  const project = parsed.project;
  const track = project.tracks[0];
  if (!track) throw new ProjectFormatError('Missing project track');
  const mediaId = crypto.randomUUID();
  const name = file.name.replace(/\.(wav|ogg)$/i, '');
  const { source } = decoded;
  project.media = [
    {
      mediaId,
      name: file.name,
      ...identity,
      sampleRateHz: source.sampleRate,
      channels: source.channels,
      framesPerChannel: source.length,
      originHint: null,
    },
  ];
  track.clips = [
    {
      clipId: crypto.randomUUID(),
      mediaId,
      timelineStartSeconds: 0,
      sourceOffsetFrames: 0,
      frameCount: source.length,
    },
  ];
  if (!preserveBaseName) {
    project.name = name;
    project.output.baseName = name.replace(/[^\w.-]/g, '_') || 'slice';
  }
  return project;
}

export function projectFileName(name: string): string {
  const stem =
    name
      .replace(/\.wosdx$/i, '')
      // Control characters are intentionally matched: they must never survive into a project file name.
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 60) || 'project';
  return `${/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem) ? '_' : ''}${stem}.wosdx`;
}
