import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, Hand, Pointer, Sun, Volume2, X } from "lucide-react";
import { useI18n } from "../i18n";

interface OnboardingGuideProps {
  active: boolean;
  onDismiss: () => void;
}

const tips = [
  { icon: Pointer, title: "onboarding.tapTitle", body: "onboarding.tapBody" },
  { icon: Hand, title: "onboarding.menuTitle", body: "onboarding.menuBody" },
  { icon: Sun, title: "onboarding.brightnessTitle", body: "onboarding.brightnessBody" },
  { icon: Volume2, title: "onboarding.volumeTitle", body: "onboarding.volumeBody" },
  { icon: ArrowDown, title: "onboarding.playerTitle", body: "onboarding.playerBody" },
  { icon: ArrowUp, title: "onboarding.returnTitle", body: "onboarding.returnBody" }
] as const;

export function OnboardingGuide({ active, onDismiss }: OnboardingGuideProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!active) return;
    const previousFocus = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [active]);

  if (!active) return null;

  return (
    <section
      ref={panelRef}
      className="onboarding-guide onboarding-tips"
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.ariaLabel")}
      tabIndex={-1}
      data-gesture-protected
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
        }
        if (event.key === "Tab") {
          const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>("button");
          if (!buttons?.length) return;
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div className="onboarding-tips-panel">
        <header className="onboarding-tips-heading">
          <h2>{t("onboarding.ariaLabel")}</h2>
          <button type="button" onClick={onDismiss} aria-label={t("common.close")}><X size={24} /></button>
        </header>
        <ul className="onboarding-tips-list">
          {tips.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <Icon size={32} aria-hidden="true" />
              <div><strong>{t(title)}</strong><span>{t(body)}</span></div>
            </li>
          ))}
        </ul>
        <footer className="onboarding-guide-footer">
          <p>{t("onboarding.scopeNote")}</p>
          <div className="onboarding-guide-actions">
            <button type="button" onClick={onDismiss}>{t("onboarding.getStarted")}</button>
          </div>
        </footer>
      </div>
    </section>
  );
}
