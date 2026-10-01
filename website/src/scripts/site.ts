import { gsap } from "gsap";
import { scenes } from "../data/scenes";

document.documentElement.classList.add("js-enabled");

const colorPreference = window.matchMedia("(prefers-color-scheme: dark)");
const themeButtons = document.querySelectorAll<HTMLButtonElement>(
  "[data-themes] button[data-theme-choice]",
);
function applyTheme(choice: string) {
  document.documentElement.dataset.themeChoice = choice;
  document.documentElement.dataset.theme =
    choice === "system" ? (colorPreference.matches ? "dark" : "light") : choice;
  themeButtons.forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.themeChoice === choice),
    ),
  );
}
applyTheme(document.documentElement.dataset.themeChoice ?? "system");
themeButtons.forEach((button) =>
  button.addEventListener("click", () => {
    const choice = button.dataset.themeChoice ?? "system";
    applyTheme(choice);
    try {
      localStorage.setItem("etymon-theme", choice);
    } catch {
      /* The selected theme still works without storage. */
    }
  }),
);
colorPreference.addEventListener("change", () => {
  if (document.documentElement.dataset.themeChoice === "system")
    applyTheme("system");
});

document
  .querySelectorAll<HTMLElement>("[data-copy-command]")
  .forEach((container) => {
    const button = container.querySelector<HTMLButtonElement>("[data-copy]")!;
    const input = container.querySelector<HTMLInputElement>("input")!;
    const status = container.querySelector<HTMLElement>('[role="status"]')!;
    let reset: ReturnType<typeof setTimeout>;
    button.addEventListener("click", async () => {
      clearTimeout(reset);
      try {
        await navigator.clipboard.writeText(input.value);
        container.classList.add("copied");
        status.textContent = "Command copied.";
        reset = setTimeout(() => {
          container.classList.remove("copied");
          status.textContent = "";
        }, 2400);
      } catch {
        container.classList.remove("copied");
        input.focus();
        input.select();
        status.textContent = "Select and copy the command using your keyboard.";
      }
    });
  });

const demo = document.querySelector<HTMLElement>("[data-demo]")!;
const panels = [...demo.querySelectorAll<HTMLElement>("[data-scene]")];
const tabs = [...demo.querySelectorAll<HTMLButtonElement>("[data-step]")];
const playback = demo.querySelector<HTMLButtonElement>("[data-playback]")!;
const description = demo.querySelector<HTMLElement>("[data-description]")!;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let active = 2;
let userPaused = reducedMotion.matches;
let onScreen = false;
let focused = false;
let hovered = false;
let timeline: gsap.core.Timeline | undefined;

function updatePlayback() {
  const paused = userPaused || reducedMotion.matches;
  const label = reducedMotion.matches
    ? "Next demo scene"
    : paused
      ? "Play demo"
      : "Pause demo";
  playback.setAttribute("aria-label", label);
  playback.title = label;
  playback.querySelector<HTMLElement>("[data-pause-icon]")!.hidden = paused;
  playback.querySelector<HTMLElement>("[data-play-icon]")!.hidden = !paused;
  demo.dataset.playback = paused ? "paused" : "playing";
}

function canRun() {
  return (
    !userPaused &&
    !reducedMotion.matches &&
    onScreen &&
    !document.hidden &&
    !focused &&
    !hovered
  );
}

function reconcilePlayback() {
  updatePlayback();
  if (canRun()) timeline?.resume();
  else timeline?.pause();
}

function showScene(index: number, manual = false) {
  timeline?.kill();
  timeline = undefined;
  active = (index + scenes.length) % scenes.length;
  const scene = scenes[active];
  const panel = panels[active];
  panels.forEach((item, i) => {
    item.hidden = i !== active;
  });
  tabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === active));
    tab.tabIndex = i === active ? 0 : -1;
  });
  description.textContent = scene.description;
  demo.dataset.active = scene.id;
  if (manual) userPaused = true;
  const typed = panel.querySelector<HTMLElement>("[data-typed]")!;
  const lines = [...panel.querySelectorAll<HTMLElement>("[data-line]")];
  const before = panel.querySelector<HTMLElement>("[data-tree-before]")!;
  const after = panel.querySelector<HTMLElement>("[data-tree-after]")!;
  const outputs = [...panel.querySelectorAll<HTMLElement>("[data-output]")];
  const completion = panel.querySelector<HTMLElement>("[data-completion]")!;
  const caret = panel.querySelector<HTMLElement>("[data-caret]")!;
  const connectors = [
    ...panel.querySelectorAll<SVGPathElement>(".connector-lines path"),
  ];
  const animatable = [
    typed,
    ...lines,
    before,
    after,
    ...outputs,
    completion,
    caret,
    ...connectors,
  ];
  gsap.set(animatable, { clearProps: "all" });
  typed.textContent = scene.command;
  if (reducedMotion.matches || manual) {
    demo.dataset.phase = "complete";
    updatePlayback();
    return;
  }
  demo.dataset.phase = "animating";
  typed.textContent = "";
  gsap.set([...lines, after, ...outputs, completion], { autoAlpha: 0 });
  gsap.set(before, { autoAlpha: 1 });
  gsap.set(outputs, { y: 12 });
  connectors.forEach((path) => {
    const length = path.getTotalLength();
    gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
  });
  const typewriter = { letters: 0 };
  timeline = gsap.timeline({
    paused: true,
    defaults: { ease: "expo.out" },
    onComplete: () => {
      if (canRun()) showScene(active + 1);
    },
  });
  timeline
    .to(
      typewriter,
      {
        letters: scene.command.length,
        duration: Math.min(1.7, 0.035 * scene.command.length + 0.35),
        ease: "none",
        onUpdate: () => {
          typed.textContent = scene.command.slice(
            0,
            Math.round(typewriter.letters),
          );
        },
      },
      0.3,
    )
    .to(caret, { autoAlpha: 0, duration: 0.15 })
    .to(lines, { autoAlpha: 1, duration: 0.35, stagger: 0.16 }, "+=.15")
    .to(before, { autoAlpha: 0, y: -7, duration: 0.4 }, "+=.1")
    .fromTo(after, { y: 10 }, { autoAlpha: 1, y: 0, duration: 0.65 }, "<.15")
    .to(connectors, { strokeDashoffset: 0, duration: 0.65 }, "<.25")
    .to(outputs, { autoAlpha: 1, y: 0, duration: 0.65, stagger: 0.14 }, "<.25")
    .to(completion, { autoAlpha: 1, duration: 0.45 }, "<.2")
    .call(() => {
      demo.dataset.phase = "complete";
    })
    .to({}, { duration: 3 });
  reconcilePlayback();
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => showScene(index, true));
  tab.addEventListener("keydown", (event) => {
    let next: number | undefined;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      showScene(next, true);
      tabs[next].focus();
    }
  });
});
playback.addEventListener("click", () => {
  // Reduced-motion playback changes scenes without spatial or typing effects.
  if (reducedMotion.matches) {
    showScene(active + 1, true);
    return;
  }
  userPaused = !userPaused;
  hovered = false;
  if (!userPaused && !timeline) showScene(active);
  reconcilePlayback();
});
demo.addEventListener("focusin", (event) => {
  focused = event.target !== playback;
  reconcilePlayback();
});
demo.addEventListener("focusout", () => {
  focused =
    demo.contains(document.activeElement) &&
    document.activeElement !== playback;
  reconcilePlayback();
});
demo.addEventListener("mouseenter", () => {
  hovered = true;
  reconcilePlayback();
});
demo.addEventListener("mouseleave", () => {
  hovered = false;
  reconcilePlayback();
});
document.addEventListener("visibilitychange", reconcilePlayback);
reducedMotion.addEventListener("change", () => {
  userPaused = reducedMotion.matches;
  showScene(active);
});
new IntersectionObserver(
  ([entry]) => {
    onScreen = entry.isIntersecting;
    reconcilePlayback();
  },
  { threshold: 0.12 },
).observe(demo);
showScene(active);
