import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { APP_CONFIG } from '@school-bus-tracking/config';
import { ArrowIcon, BrandBusIcon, MarketingIcon } from './LandingIcons';
import { DemoPreview } from './DemoPreview';
import styles from './landing.module.css';

export const metadata: Metadata = {
  title: `${APP_CONFIG.appName} | Every school day, on the right track`,
  description:
    'A clearer school journey for everyone. Bring live bus tracking, routes, crew operations, and parent updates into one place.',
};

export default function LandingPage() {
  return (
    <div className={styles.site} id="top">
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>

      <div className={styles.noticeBar}>
        <div className={styles.container}>
          <span className={styles.noticeDot} aria-hidden="true" />
          <span>Made for the moments that matter on every school run.</span>
          <a href="#how-it-works">
            Discover how it works <ArrowIcon />
          </a>
        </div>
      </div>

      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerInner}`}>
          <a href="#top" className={styles.brand} aria-label={`${APP_CONFIG.appName}, back to top`}>
            <span className={styles.brandMark}>
              <Image src="/kidbus-logo.svg" alt="" width={42} height={42} priority />
            </span>
            <span className={styles.brandName}>{APP_CONFIG.appName}</span>
          </a>
          <nav className={styles.nav} aria-label="Main navigation">
            <a href="#features">Why it matters</a>
            <a href="#how-it-works">How it works</a>
            <a href="#demo">Live demo</a>
          </nav>
          <Link href="/login" className={styles.headerLogin}>
            Log in <ArrowIcon />
          </Link>
        </div>
      </header>

      <main id="main-content">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <div className={styles.eyebrow}>
                <span className={styles.eyebrowLine} aria-hidden="true" />
                THE SCHOOL JOURNEY, REIMAGINED
              </div>
              <h1 id="hero-title">
                Every school day,
                <br />
                <em>on the right track.</em>
              </h1>
              <p className={styles.heroLead}>
                A clearer journey for everyone. Bring buses, routes, crew and families together in
                one easy-to-follow place — from the first pick-up to the last drop-off.
              </p>
              <div className={styles.heroActions}>
                <a href="#demo" className={styles.primaryButton}>
                  View live demo <ArrowIcon />
                </a>
                <a href="#how-it-works" className={styles.inlineLink}>
                  See how it works <ArrowIcon />
                </a>
              </div>
              <div className={styles.heroBenefits} aria-label="Platform highlights">
                <span>
                  <MarketingIcon name="pin" /> Live trip visibility
                </span>
                <span>
                  <MarketingIcon name="shield" /> Built around student safety
                </span>
              </div>
            </div>

            <div className={styles.heroVisual}>
              <div className={styles.heroPhoto}>
                <Image
                  src="/images/school-bus-hero.jpg"
                  alt="A yellow school bus arriving outside a school campus"
                  fill
                  priority
                  sizes="(max-width: 900px) 100vw, 52vw"
                  className={styles.heroImage}
                />
                <div className={styles.photoCaption}>A little more peace of mind, every mile.</div>
              </div>
              <div className={styles.heroRouteCard} aria-label="Illustrative route preview">
                <div className={styles.routeIcon}>
                  <BrandBusIcon />
                </div>
                <div>
                  <span className={styles.routeOverline}>SAMPLE ROUTE PREVIEW</span>
                  <strong>Morning North Loop</strong>
                  <span className={styles.routeStatus}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    On the way to school
                  </span>
                </div>
              </div>
              <div className={styles.heroAccessCard}>
                <div className={styles.accessTopline}>
                  <span className={styles.accessIcon}>
                    <MarketingIcon name="school" />
                  </span>
                  <span>YOUR WORKSPACE</span>
                </div>
                <h2>Already part of the journey?</h2>
                <p>Access your school, parent or crew account here.</p>
                <Link href="/login" className={styles.accessButton}>
                  Log in to your account <ArrowIcon />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className={styles.audienceBand}>
          <div className={`${styles.container} ${styles.audienceInner}`}>
            <span>ONE CONNECTED SCHOOL COMMUNITY</span>
            <div className={styles.audienceList}>
              <span>
                <MarketingIcon name="school" /> For school teams
              </span>
              <span>
                <MarketingIcon name="people" /> For families
              </span>
              <span>
                <BrandBusIcon /> For drivers &amp; crew
              </span>
            </div>
          </div>
        </div>

        <section className={styles.features} id="features" aria-labelledby="features-title">
          <div className={styles.container}>
            <div className={styles.sectionIntro}>
              <div>
                <span className={styles.sectionLabel}>THE WAY FORWARD</span>
                <h2 id="features-title">
                  More clarity for the people
                  <br />
                  who care the most.
                </h2>
              </div>
              <p>
                School transport has a lot of moving parts. We make it easier to see what is
                happening, stay connected and make each day run a little smoother.
              </p>
            </div>
            <div className={styles.featureGrid}>
              <article className={styles.featureCard}>
                <div className={`${styles.featureIcon} ${styles.featureIconYellow}`}>
                  <MarketingIcon name="pin" />
                </div>
                <span className={styles.featureNumber}>01 / VISIBILITY</span>
                <h3>Know where the bus is.</h3>
                <p>
                  Follow active trips on a live map, with route progress, next stops and estimated
                  arrivals in view.
                </p>
                <a href="#demo" className={styles.featureFooter}>
                  See trip tracking <ArrowIcon />
                </a>
              </article>
              <article className={styles.featureCard}>
                <div className={`${styles.featureIcon} ${styles.featureIconGreen}`}>
                  <MarketingIcon name="bell" />
                </div>
                <span className={styles.featureNumber}>02 / CONNECTION</span>
                <h3>Keep families in the loop.</h3>
                <p>
                  Give parents a view of their child’s journey, including boarding and drop-off
                  updates when they happen.
                </p>
                <a href="#demo" className={styles.featureFooter}>
                  See the sample journey <ArrowIcon />
                </a>
              </article>
              <article className={styles.featureCard}>
                <div className={`${styles.featureIcon} ${styles.featureIconBlue}`}>
                  <MarketingIcon name="route" />
                </div>
                <span className={styles.featureNumber}>03 / SIMPLICITY</span>
                <h3>Run it all together.</h3>
                <p>
                  Manage buses, routes, stops, trips and crew from one workspace, instead of
                  juggling separate tools.
                </p>
                <a href="#demo" className={styles.featureFooter}>
                  Explore the platform <ArrowIcon />
                </a>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.how} id="how-it-works" aria-labelledby="how-title">
          <div className={`${styles.container} ${styles.howGrid}`}>
            <div className={styles.howCopy}>
              <span className={styles.sectionLabel}>SIMPLE FROM START TO FINISH</span>
              <h2 id="how-title">
                One journey.
                <br />
                Every perspective.
              </h2>
              <p>
                A shared view of the school run helps the whole community move with confidence.
                Here’s how it comes together.
              </p>
              <a href="#demo" className={styles.inlineLink}>
                Explore the demo <ArrowIcon />
              </a>
            </div>
            <div className={styles.stepList}>
              <div className={styles.step}>
                <span className={styles.stepNumber}>01</span>
                <div>
                  <h3>Plan the day</h3>
                  <p>School teams organize their routes, buses, stops and crew in one place.</p>
                </div>
                <MarketingIcon name="route" />
              </div>
              <div className={styles.step}>
                <span className={styles.stepNumber}>02</span>
                <div>
                  <h3>Follow the journey</h3>
                  <p>As trips run, live location and stop progress make the next step clearer.</p>
                </div>
                <MarketingIcon name="pin" />
              </div>
              <div className={styles.step}>
                <span className={styles.stepNumber}>03</span>
                <div>
                  <h3>Stay in the know</h3>
                  <p>Families see their bus and receive important boarding and drop-off updates.</p>
                </div>
                <MarketingIcon name="bell" />
              </div>
            </div>
          </div>
        </section>

        <section className={styles.demoSection} id="demo" aria-labelledby="demo-title">
          <div className={styles.container}>
            <div className={styles.demoIntro}>
              <div>
                <span className={styles.demoLabel}>
                  <span aria-hidden="true" /> INTERACTIVE PRODUCT PREVIEW
                </span>
                <h2 id="demo-title">
                  See the journey
                  <br />
                  from every seat.
                </h2>
              </div>
              <p>
                Explore a sample school run. Switch between school, parent and crew views, then play
                the trip to see how each stop changes the picture.
              </p>
            </div>
            <DemoPreview />
            <p className={styles.demoDisclaimer}>
              This is a guided, read-only preview using fictional sample data. It does not show real
              buses, students or live locations.
            </p>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <div className={`${styles.container} ${styles.closingInner}`}>
            <div>
              <span className={styles.sectionLabel}>READY WHEN YOU ARE</span>
              <h2 id="closing-title">Let’s make the school run feel simpler.</h2>
              <p>Take a look around the demo, or head straight to your school workspace.</p>
            </div>
            <div className={styles.closingActions}>
              <Link href="/login" className={styles.primaryButton}>
                Log in to your account <ArrowIcon />
              </Link>
              <a href="#demo" className={styles.inlineLink}>
                View live demo <ArrowIcon />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerInner}`}>
          <div className={styles.footerBrand}>
            <span className={styles.brandMark}>
              <Image src="/kidbus-logo.svg" alt="" width={42} height={42} />
            </span>
            <span>
              <strong>{APP_CONFIG.appName}</strong>
              <small>Better journeys start together.</small>
            </span>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#features">The platform</a>
            <a href="#how-it-works">How it works</a>
            <a href="#demo">Demo</a>
            <Link href="/login">Log in</Link>
          </nav>
          <span className={styles.footerNote}>Built for the whole school community.</span>
        </div>
      </footer>
    </div>
  );
}
