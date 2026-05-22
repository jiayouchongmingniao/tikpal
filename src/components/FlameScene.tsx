const FIREPLACE_BACKGROUND_SRC = "/assets/fireplace-bg-2560x720.png";
const FLAME_VIDEO_SRC = "/assets/output_2560x720-4k.mp4";

interface FlameSceneProps {
  lowPower?: boolean;
}

export function FlameScene({ lowPower = false }: FlameSceneProps) {
  return (
    <div className={`flame-scene ${lowPower ? "is-low-power" : ""}`} aria-hidden="true">
      <img className="fireplace-backdrop" src={FIREPLACE_BACKGROUND_SRC} alt="" draggable={false} />
      <video
        className="flame-video"
        src={FLAME_VIDEO_SRC}
        poster={FIREPLACE_BACKGROUND_SRC}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      />
    </div>
  );
}
