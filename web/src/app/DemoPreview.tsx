'use client';

import { useEffect, useState } from 'react';
import { ArrowIcon, BrandBusIcon, MarketingIcon } from './LandingIcons';
import styles from './landing.module.css';

type Perspective = 'school' | 'parent' | 'crew';

const STOPS = [
  { name: 'Oak Street', x: 12, y: 78, mapX: 76, mapY: 296 },
  { name: 'Park Avenue', x: 38, y: 58, mapX: 243, mapY: 220 },
  { name: 'Library Road', x: 62, y: 41, mapX: 397, mapY: 156 },
  { name: 'School Gate', x: 86, y: 21, mapX: 550, mapY: 80 },
] as const;

const PERSPECTIVES: Record<
  Perspective,
  { label: string; heading: string; description: string; detail: string }
> = {
  school: {
    label: 'School dashboard',
    heading: 'The whole route in view.',
    description: 'See where the bus is and which stops are still ahead.',
    detail: 'Route progress, all in one place',
  },
  parent: {
    label: 'Parent view',
    heading: 'Peace of mind, on the go.',
    description: 'Follow the bus and stay in the know about the next stop.',
    detail: 'A clear view of the journey',
  },
  crew: {
    label: 'Crew view',
    heading: 'Ready for the next stop.',
    description: 'Keep the route and upcoming stop close at hand.',
    detail: 'The day’s run at a glance',
  },
};

const ROUTE_PATH =
  'M 76 296 C 160 296 170 220 243 220 C 320 220 310 156 397 156 C 480 156 470 80 550 80';

export function DemoPreview() {
  const [perspective, setPerspective] = useState<Perspective>('school');
  const [stopIndex, setStopIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const lastIndex = STOPS.length - 1;
  const currentStop = STOPS[stopIndex];
  const nextStop = STOPS[stopIndex + 1];
  const view = PERSPECTIVES[perspective];

  useEffect(() => {
    if (!playing || stopIndex === lastIndex) return;
    const timer = window.setTimeout(
      () => setStopIndex((index) => Math.min(index + 1, lastIndex)),
      2100,
    );
    return () => window.clearTimeout(timer);
  }, [playing, stopIndex, lastIndex]);

  useEffect(() => {
    if (stopIndex === lastIndex) setPlaying(false);
  }, [stopIndex, lastIndex]);

  const togglePlayback = () => {
    if (playing) {
      setPlaying(false);
    } else {
      if (stopIndex === lastIndex) setStopIndex(0);
      setPlaying(true);
    }
  };

  const advance = () => {
    setPlaying(false);
    setStopIndex((index) => (index === lastIndex ? 0 : index + 1));
  };

  return (
    <div className={styles.preview}>
      <div className={styles.previewTopbar}>
        <div className={styles.previewBrand}>
          <span className={styles.previewBrandMark}>
            <BrandBusIcon />
          </span>
          <strong>School Bus Tracking</strong>
          <span className={styles.previewDivider} aria-hidden="true" />
          <span>Product preview</span>
        </div>
        <span className={styles.previewBadge}>
          <span aria-hidden="true" /> SAMPLE DATA
        </span>
      </div>
      <div className={styles.previewContent}>
        <div className={styles.previewHeading}>
          <div>
            <span className={styles.previewOverline}>MORNING RUN · NORTH LOOP</span>
            <h3>Take a closer look at the journey.</h3>
          </div>
          <div className={styles.viewSwitch} role="group" aria-label="Choose a demo perspective">
            {(['school', 'parent', 'crew'] as const).map((item) => (
              <button
                type="button"
                key={item}
                className={perspective === item ? styles.viewActive : undefined}
                aria-pressed={perspective === item}
                onClick={() => setPerspective(item)}
              >
                {item === 'school' ? 'School' : item === 'parent' ? 'Parent' : 'Crew'} view
              </button>
            ))}
          </div>
        </div>

        <div className={styles.previewGrid}>
          <div className={styles.map} aria-label="Illustrative map of the sample North Loop route">
            {/* The map and the marker share percent coordinates at every viewport size. */}
            <svg
              viewBox="0 0 640 380"
              preserveAspectRatio="none"
              className={styles.mapCanvas}
              aria-hidden="true"
            >
              <rect width="640" height="380" fill="#e9eee7" />
              <path
                d="M0 0h235l-50 108L0 125ZM445 0h195v147l-111-21-98-66ZM0 251l133 21 99 108H0ZM446 380l76-122 118 7v115Z"
                fill="#d5e5d1"
              />
              <path
                d="M18 64 624 340M-10 324 642 24M125-15l59 400M331-20l61 420M530-10l-62 404"
                stroke="#fff"
                strokeWidth="29"
              />
              <path
                d="M18 64 624 340M-10 324 642 24M125-15l59 400M331-20l61 420M530-10l-62 404"
                stroke="#dce3d8"
                strokeWidth="2"
              />
              <path
                d={ROUTE_PATH}
                fill="none"
                stroke="#fff"
                strokeWidth="17"
                strokeLinecap="round"
              />
              <path
                d={ROUTE_PATH}
                fill="none"
                stroke="#e9a82f"
                strokeWidth="9"
                strokeLinecap="round"
              />
              <path
                d={ROUTE_PATH}
                fill="none"
                stroke="#fff5d5"
                strokeWidth="1.5"
                strokeDasharray="5 9"
                strokeLinecap="round"
              />
              {STOPS.map((stop, index) => (
                <g key={stop.name}>
                  <circle cx={stop.mapX} cy={stop.mapY} r="12" fill="white" />
                  <circle
                    cx={stop.mapX}
                    cy={stop.mapY}
                    r="6"
                    fill={index <= stopIndex ? '#17473c' : '#e9a82f'}
                  />
                </g>
              ))}
            </svg>
            <span className={styles.mapRouteLabel}>
              <MarketingIcon name="route" /> North Loop
            </span>
            <span className={styles.mapSchoolLabel}>
              <MarketingIcon name="school" /> School Gate
            </span>
            <span className={styles.mapParkLabel}>COMMUNITY PARK</span>
            <span
              className={styles.mapBus}
              style={{ left: `${currentStop.x}%`, top: `${currentStop.y}%` }}
              aria-hidden="true"
            >
              <BrandBusIcon />
            </span>
            <span className={styles.mapFootnote}>Illustrative map · not a live location</span>
          </div>

          <div className={styles.previewSide}>
            <div className={styles.sideEyebrow}>
              <span className={styles.sideDot} aria-hidden="true" />
              {view.label}
            </div>
            <h4>{view.heading}</h4>
            <p className={styles.sideDescription}>{view.description}</p>
            <div className={styles.currentStop} aria-live="polite" aria-atomic="true">
              <span>{stopIndex === lastIndex ? 'JOURNEY COMPLETE' : 'CURRENT STOP'}</span>
              <strong>{currentStop.name}</strong>
              <small>{nextStop ? `Up next: ${nextStop.name}` : 'Arrived at school'}</small>
            </div>
            <div className={styles.stopHeading}>
              <span>{view.detail}</span>
              <strong>
                {stopIndex + 1} / {STOPS.length}
              </strong>
            </div>
            <div
              className={styles.progressTrack}
              aria-label={`${stopIndex + 1} of ${STOPS.length} stops reached`}
            >
              <span style={{ width: `${((stopIndex + 1) / STOPS.length) * 100}%` }} />
            </div>
            <ol className={styles.stopList}>
              {STOPS.map((stop, index) => (
                <li
                  key={stop.name}
                  className={
                    index === stopIndex
                      ? styles.stopCurrent
                      : index < stopIndex
                        ? styles.stopVisited
                        : undefined
                  }
                >
                  <span className={styles.stopBullet} aria-hidden="true">
                    {index < stopIndex ? <MarketingIcon name="check" /> : null}
                  </span>
                  <span>{stop.name}</span>
                  <small>
                    {index < stopIndex ? 'Visited' : index === stopIndex ? 'Here now' : 'Upcoming'}
                  </small>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className={styles.previewActions}>
          <span>Try it out — watch this sample route move from stop to stop.</span>
          <div>
            <button type="button" className={styles.playButton} onClick={togglePlayback}>
              {playing
                ? 'Pause trip'
                : stopIndex === lastIndex
                  ? 'Replay trip'
                  : 'Play sample trip'}
              <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
            </button>
            <button type="button" className={styles.nextButton} onClick={advance}>
              {stopIndex === lastIndex ? 'Start again' : 'Next stop'} <ArrowIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
