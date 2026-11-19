export const CAMERAS = [
  { id: "hold", label: "Hold", line: "The camera stays locked off, almost still." },
  { id: "push", label: "Push in", line: "A slow, steady dolly push toward the subject." },
  { id: "orbit", label: "Orbit", line: "A gentle orbit around the subject, smooth and unhurried." },
  { id: "drift", label: "Drift", line: "Subtle handheld drift, natural and quiet." },
  { id: "rise", label: "Rise", line: "A slow crane rise, revealing a little more of the scene." },
  { id: "rack", label: "Rack", line: "A slow rack of focus from the subject into the background." },
] as const;

export type CameraId = (typeof CAMERAS)[number]["id"];

export const SAMPLES = [
  {
    id: "night",
    title: "Black coat",
    style: "Cinematic",
    src: "/samples/night.mp4",
    poster: "/samples/night.jpg",
    prompt: "She walks two steps toward the camera, stops, and looks back over her shoulder. Wet night street, one blue neon sign, long black coat.",
    camera: "drift" as CameraId,
  },
  {
    id: "ink",
    title: "Red coat",
    style: "Illustrated",
    src: "/samples/ink.mp4",
    poster: "/samples/ink.jpg",
    prompt: "The drawn figure turns their head, then takes one step. Ink line, flat red coat, cream paper, no extra people.",
    camera: "hold" as CameraId,
  },
  {
    id: "ivory",
    title: "Ivory suit",
    style: "Editorial",
    src: "/samples/ivory.mp4",
    poster: "/samples/ivory.jpg",
    prompt: "They lift their chin and turn slowly to the left. Seamless white studio, hard light, structured ivory suit.",
    camera: "push" as CameraId,
  },
  {
    id: "field",
    title: "Linen",
    style: "Daylight",
    src: "/samples/field.mp4",
    poster: "/samples/field.jpg",
    prompt: "They walk forward through tall dry grass and raise one hand against the sun. Late afternoon, linen shirt, warm film.",
    camera: "drift" as CameraId,
  },
] as const;

export type SampleId = (typeof SAMPLES)[number]["id"];

export function cameraLine(id: CameraId): string {
  return CAMERAS.find((camera) => camera.id === id)?.line ?? CAMERAS[0].line;
}
