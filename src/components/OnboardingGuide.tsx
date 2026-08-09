import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useI18n } from "../i18n";

interface OnboardingGuideProps {
  active: boolean;
  step: number;
  onDismiss: () => void;
  onNext: () => void;
  onBack: () => void;
}

const steps = [
  {
    titleKey: "onboarding.step1Title",
    bodyKey: "onboarding.step1Body",
    noteKey: "onboarding.step1Note",
    gesture: "tap"
  },
  {
    titleKey: "onboarding.step2Title",
    bodyKey: "onboarding.step2Body",
    noteKey: "onboarding.step2Note",
    gesture: "edges"
  },
  {
    titleKey: "onboarding.step3Title",
    bodyKey: "onboarding.step3Body",
    noteKey: "onboarding.step3Note",
    gesture: "swipe"
  }
] as const;

function GestureSample({ gesture, onPractice, onMove, onEnd }: { gesture: typeof steps[number]["gesture"]; onPractice: (event: ReactPointerEvent<HTMLDivElement>) => void; onMove: (event: ReactPointerEvent<HTMLDivElement>) => void; onEnd: () => void }) {
  const { t } = useI18n();

  return (
    <div className={`wizard-sample gesture-${gesture}`} onPointerDown={onPractice} onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={onEnd} role="button" tabIndex={0} aria-label={t("onboarding.sampleAria")}>
      <div className="wizard-sample-screen">
        <span className="wizard-sample-clock">20:45</span>
        <span className="wizard-sample-track">{t("onboarding.sampleTrack")}</span>
        <span className="wizard-sample-control control-left">{t("onboarding.sampleBrightness")}</span>
        <span className="wizard-sample-control control-right">{t("onboarding.sampleVolume")}</span>
        <span className="wizard-sample-player">{t("onboarding.samplePlayer")}</span>
        <i className="wizard-finger" />
        <i className="wizard-path path-one" />
        <i className="wizard-path path-two" />
        <span className="wizard-practice-hint">{t("onboarding.sampleTry")}</span>
      </div>
    </div>
  );
}

export function OnboardingGuide({
  active,
  step,
  onDismiss,
  onNext,
  onBack
}: OnboardingGuideProps) {
  const { t } = useI18n();
  const currentStep = steps[Math.min(Math.max(step, 0), steps.length - 1)];
  const isLastStep = step >= steps.length - 1;
  const practiceStartRef = useRef<{ x: number; y: number } | null>(null);
  const [practiceState, setPracticeState] = useState<"idle" | "ready">("idle");

  useEffect(() => {
    setPracticeState("idle");
    practiceStartRef.current = null;
  }, [step, active]);

  function handlePracticeStart(event: ReactPointerEvent<HTMLDivElement>) {
    practiceStartRef.current = { x: event.clientX, y: event.clientY };
    if (currentStep.gesture === "tap") {
      setPracticeState("ready");
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePracticeMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = practiceStartRef.current;
    if (!start) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance >= 24) setPracticeState("ready");
  }

  function handlePracticeEnd() {
    practiceStartRef.current = null;
  }

  useEffect(() => {
    if (!active) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key === "ArrowRight" && !isLastStep) {
        event.preventDefault();
        onNext();
        return;
      }
      if (event.key === "ArrowLeft" && step > 0) {
        event.preventDefault();
        onBack();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, isLastStep, onBack, onDismiss, onNext, step]);

  if (!active) return null;

  return (
    <section className="onboarding-guide is-background-hidden" aria-label={t("onboarding.ariaLabel")} data-gesture-protected>
      <button className="wizard-exit-button" type="button" onClick={onDismiss} aria-label={t("common.close")}>
        <X size={24} />
      </button>
      <div className="onboarding-guide-panel">
        <div className="onboarding-guide-header">
          <span>{t("app.name")}</span>
          <strong>{t("onboarding.title")}</strong>
          <p>{t("onboarding.subtitle")}</p>
        </div>

        <div className="wizard-stage">
          <div className="wizard-copy">
            <div className="onboarding-guide-progress" aria-hidden="true">
              {steps.map((_, index) => (
                <i key={index} className={index <= step ? "is-active" : ""} />
              ))}
            </div>
            <strong>{t(currentStep.titleKey)}</strong>
            <span>{t(currentStep.bodyKey)}</span>
            <em>{t(currentStep.noteKey)}</em>
          </div>

          <div>
            <GestureSample
              gesture={currentStep.gesture}
              onPractice={handlePracticeStart}
              onMove={handlePracticeMove}
              onEnd={handlePracticeEnd}
            />
            <div className={`wizard-practice-status ${practiceState === "ready" ? "is-ready" : ""}`} aria-live="polite">
              {practiceState === "ready" ? t("onboarding.practiceSuccess") : t("onboarding.practicePrompt")}
            </div>
          </div>
        </div>

        <div className="onboarding-guide-footer">
          <p>{t("onboarding.footer")}</p>
          <p className="onboarding-guide-scope">{t("onboarding.scopeNote")}</p>
          <div className="onboarding-guide-actions">
            <button type="button" onClick={onBack} disabled={step === 0}>
              <ArrowLeft size={18} />
              {t("onboarding.previous")}
            </button>
            {isLastStep ? (
              <button type="button" onClick={onDismiss}>
                {t("onboarding.getStarted")}
              </button>
            ) : (
              <button type="button" onClick={onNext}>
                {t("onboarding.next")}
                <ArrowRight size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
