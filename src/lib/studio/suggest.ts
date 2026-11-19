import { SAMPLES, type SampleId } from "./presets.ts";

export type SuggestMode = "animate" | "prompt" | "recast";

const IDEAS: Record<SuggestMode, string[]> = {
  recast: [
    "She turns, holds the look, and takes one step closer. The coat and the room stay.",
    "Only the face changes. The walk, the light, and the coat stay exactly as they are.",
    "They glance off camera, then back. The same step, the same room, a different face.",
    "A small nod, then they walk past. The clothes and the light do not change.",
  ],
  animate: [
    "A slow push in as they lift their chin. Cloth moves. The room stays still.",
    "They look back over one shoulder. One step. Warm light, no extra people.",
    "They breathe, shift their weight, and settle. The camera barely moves.",
    "One hand comes up, then lowers. The background stays locked.",
  ],
  prompt: [
    "One person walks toward the camera and stops. Wet night street, one blue sign, long coat.",
    "They turn slowly in a white studio. Hard light, ivory suit, no one else in frame.",
    "They sit, look up, and say nothing. A quiet kitchen, morning light, one chair.",
    "They cross a platform and stop at the yellow line. Fluorescent light, empty car behind them.",
  ],
};

const TAILS: Record<SuggestMode, string[]> = {
  recast: [
    " Only the face changes. The step and the room stay.",
    " Keep the coat, the light, and the timing.",
    " Same body, same clothes, same camera. A different person.",
    " Do not add anyone else, and do not change the set.",
  ],
  animate: [
    " The camera holds. Cloth, breath, and the room stay.",
    " One move, then a hold. No extra people.",
    " Keep the photograph as frame one. Motion starts from there.",
    " No cut, no new clothes, no change of room.",
  ],
  prompt: [
    " One person, one move, no cut, no extra people.",
    " The shot stays on them until they stop.",
    " Natural room sound. No music, no narration.",
    " End on a held look. Do not fade or cut.",
  ],
};

const BEATS: Record<SampleId, string[]> = {
  night: [
    " She holds the look. Rain stays on the coat. No one else enters.",
    " She stops under the sign. The street stays empty.",
  ],
  ink: [
    " The line stays spare. The red coat does not change. The paper stays still.",
    " The drawing does not gain a background. One step, then a hold.",
  ],
  ivory: [
    " The turn finishes. The suit stays sharp. The studio stays empty.",
    " The light stays hard. No second person walks in.",
  ],
  field: [
    " The hand stays up. The grass moves. The light stays late.",
    " They keep walking. The field does not cut to a close-up.",
  ],
};

const CHARACTER = [
  " The uploaded person takes their place. The step, the light, and the room stay.",
  " Only this person's face is used. The performance does not change.",
  " Hair, skin, and features come from the upload. The body and the room stay.",
  " Match this person's age. Do not borrow the performer's face.",
  " If the upload shows a side, keep that likeness from the front too.",
];

const CUSTOM = [
  " Keep this performance. The uploaded person is the only change.",
  " The walk and the room stay. The new person takes the place.",
  " Do not restyle the clothes, the set, or the camera.",
  " The new person wears what the performer wears. Only the face changes.",
];

function unique(items: string[]): string[] {
  return items.filter((item, index) => item && items.indexOf(item) === index);
}

export function suggestionList(
  mode: SuggestMode,
  prompt: string,
  sampleId: SampleId | null = null,
  hasCharacter = false,
  custom = false,
): string[] {
  const text = prompt;
  const sample = SAMPLES.find((item) => item.id === sampleId);
  const options: string[] = [];
  if (!text.trim()) {
    if (hasCharacter) options.push("The uploaded person takes the performer's place. The motion and the room stay.");
    if (custom) options.push("Describe the motion in this performance. The uploaded person keeps that motion.");
    if (sample && !hasCharacter) options.push(sample.prompt);
    options.push(...IDEAS[mode]);
  } else {
    const match = IDEAS[mode].find((item) => item.toLowerCase().startsWith(text.toLowerCase()) && item.length > text.length);
    if (match) options.push(match.slice(text.length));
    if (hasCharacter) {
      for (const line of CHARACTER) {
        if (!text.endsWith(line.trim())) options.push(text.endsWith(" ") ? line.trimStart() : line);
      }
    }
    if (custom && !sample) {
      for (const line of CUSTOM) {
        if (!text.endsWith(line.trim())) options.push(text.endsWith(" ") ? line.trimStart() : line);
      }
    }
    if (sample && text.trim() === sample.prompt.trim() && !hasCharacter) {
      for (const beat of BEATS[sample.id]) {
        if (!text.endsWith(beat.trim())) options.push(text.endsWith(" ") ? beat.trimStart() : beat);
      }
    }
    for (const tail of TAILS[mode]) {
      if (!text.endsWith(tail.trim())) options.push(text.endsWith(" ") ? tail.trimStart() : tail);
    }
  }
  return unique(options);
}

export function suggestionFor(
  mode: SuggestMode,
  prompt: string,
  idea = 0,
  sampleId: SampleId | null = null,
  hasCharacter = false,
  custom = false,
): string {
  const options = suggestionList(mode, prompt, sampleId, hasCharacter, custom);
  if (!options.length) return "";
  const index = ((idea % options.length) + options.length) % options.length;
  return options[index] ?? "";
}
