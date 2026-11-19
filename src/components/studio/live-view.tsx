import { SceneBench } from "@/components/studio/scene-bench";

export function LiveView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SceneBench />
      <p className="mt-3 max-w-3xl text-sm font-light leading-6 text-muted">
        The left picture is the camera with nothing on it. The right one is that same picture with the look, updating live. Set the scene here, then open Meetings and keep adjusting it while you are in the call.
      </p>
    </div>
  );
}
