export type EpisodeTransformKeyframe = [timeSeconds: number, x: number, bottom: number, scale: number, rotationDegrees: number, squashX: number, flipX: boolean];

export interface EpisodeTransformSample {
  x: number; bottom: number; scale: number; rotationDegrees: number; squashX: number; flipX: boolean;
}
export interface AnimeEpisodeCharacterTrack { id: string; name: string; assetInPackage: string; keyframes: EpisodeTransformKeyframe[]; }
export interface AnimeEpisodeProject {
  schema: "ai-creative-studio.anime-episode"; schemaVersion: 1; projectId: string; title: string;
  durationSeconds: number; fps: number; logicalCoordinateSpace: { width: number; height: number };
  characters: AnimeEpisodeCharacterTrack[];
  scenes: Array<{id:string;start:number;end:number;title:string;camera:string;action:string}>;
  dialogue: Array<{at:number;until:number;speaker:string;name:string;text:string}>;
}
export function validateAnimeEpisode(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["Episode must be an object."];
  const episode = value as Partial<AnimeEpisodeProject>;
  const issues: string[] = [];
  if (episode.schema !== "ai-creative-studio.anime-episode" || episode.schemaVersion !== 1) issues.push("Unsupported episode schema/version.");
  if (!Number.isFinite(episode.durationSeconds) || Number(episode.durationSeconds) <= 0 || Number(episode.durationSeconds) > 600) issues.push("durationSeconds must be in (0, 600].");
  if (!Number.isFinite(episode.fps) || Number(episode.fps) < 1 || Number(episode.fps) > 60) issues.push("fps must be between 1 and 60.");
  const characters = Array.isArray(episode.characters) ? episode.characters : [];
  if (!characters.length) issues.push("At least one character track is required.");
  const ids = new Set<string>();
  for (const character of characters) {
    if (!character.id || ids.has(character.id)) issues.push("Character IDs must be non-empty and unique: " + character.id);
    ids.add(character.id);
    if (!Array.isArray(character.keyframes) || character.keyframes.length < 2) { issues.push("Character " + character.id + " needs at least two keyframes."); continue; }
    let previousTime = -Infinity;
    for (const frame of character.keyframes) {
      const [time, x, bottom, scale, rotation, squash, flip] = frame;
      if (![time,x,bottom,scale,rotation,squash].every(Number.isFinite)) issues.push("Character " + character.id + " contains a non-finite keyframe value.");
      if (time < 0 || time > Number(episode.durationSeconds)) issues.push("Character " + character.id + " has a keyframe outside the episode duration.");
      if (time <= previousTime) issues.push("Character " + character.id + " keyframes must be sorted with unique timestamps.");
      if (scale <= 0 || squash <= 0) issues.push("Character " + character.id + " scale values must be positive.");
      if (typeof flip !== "boolean") issues.push("Character " + character.id + " flipX must be boolean.");
      previousTime = time;
    }
  }
  for (const scene of Array.isArray(episode.scenes) ? episode.scenes : []) if (scene.start < 0 || scene.end <= scene.start || scene.end > Number(episode.durationSeconds)) issues.push("Invalid scene interval: " + scene.id);
  return [...new Set(issues)];
}
export function sampleEpisodeTransform(track: EpisodeTransformKeyframe[], timeSeconds: number): EpisodeTransformSample {
  if (!track.length) throw new Error("Cannot sample an empty animation track.");
  const frames = [...track].sort((a,b) => a[0]-b[0]);
  const pack = (f: EpisodeTransformKeyframe): EpisodeTransformSample => ({x:f[1],bottom:f[2],scale:f[3],rotationDegrees:f[4],squashX:f[5],flipX:f[6]});
  const first=frames[0], last=frames[frames.length-1];
  if (timeSeconds <= first[0]) return pack(first);
  if (timeSeconds >= last[0]) return pack(last);
  const rightIndex=frames.findIndex(f=>f[0]>=timeSeconds), left=frames[rightIndex-1], right=frames[rightIndex];
  const p=Math.max(0,Math.min(1,(timeSeconds-left[0])/(right[0]-left[0]))), e=p*p*(3-2*p), mix=(a:number,b:number)=>a+(b-a)*e;
  return {x:mix(left[1],right[1]),bottom:mix(left[2],right[2]),scale:mix(left[3],right[3]),rotationDegrees:mix(left[4],right[4]),squashX:mix(left[5],right[5]),flipX:p<.5?left[6]:right[6]};
}
