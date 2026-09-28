'use client';

import React, { useEffect, useId, useState } from 'react';
import type { MarketingUtmParameters } from '@school-bus-tracking/shared-types';
import { getApiErrorMessage, unwrapEnvelope } from '../lib/errors';
import { apiClient } from '../services/api';
import styles from './landing.module.css';

/**
 * The public "Request a Demo" form (Session 4).
 *
 * Everything sensitive happens server-side; this component only:
 *
 * - collects the visitor's own contact details (never a campaign, school or
 *   recipient id — attribution rides on an HttpOnly cookie the server set on
 *   a tracked click and resolves itself);
 * - echoes the allowlisted `utm_*` parameters from the landing URL;
 * - renders a visually hidden honeypot field bots tend to fill;
 * - submits through the shared `apiClient` (same-origin `/api/v1`, CSRF and
 *   error envelopes handled once) and shows loading / success / error states.
 *
 * Wording note: this requests a demo — it does not book one. There is no
 * calendar integration, so the success message promises a follow-up, never a
 * confirmed appointment.
 */

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

interface FieldErrors {
  full_name?: string;
  email?: string;
  institution_name?: string;
  country?: string;
  consent?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function DemoRequestForm() {
  const formId = useId();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [institution, setInstitution] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [contactTime, setContactTime] = useState('');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [utm, setUtm] = useState<MarketingUtmParameters | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [serverError, setServerError] = useState<string | null>(null);

  // Attribution context: only the allowlisted utm_* keys of the current URL.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const captured: Record<string, string> = {};
      for (const key of UTM_KEYS) {
        const value = params.get(key);
        if (value && value.trim() !== '') {
          captured[key] = value.slice(0, 120);
        }
      }
      setUtm(Object.keys(captured).length > 0 ? (captured as MarketingUtmParameters) : null);
    } catch {
      setUtm(null);
    }
  }, []);

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (fullName.trim().length < 2) {
      errors.full_name = 'Please enter your full name.';
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = 'Please enter a valid work email address.';
    }
    if (institution.trim().length < 2) {
      errors.institution_name = 'Please enter your school or institution name.';
    }
    if (country.trim() !== '' && !/^[A-Za-z]{2}$/.test(country.trim())) {
      errors.country = 'Please use a 2-letter country code (e.g. IN, AE, GB).';
    }
    if (!consent) {
      errors.consent = 'Please confirm you agree to be contacted about your request.';
    }
    return errors;
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setStatus('idle');
      return;
    }
    setStatus('submitting');
    try {
      unwrapEnvelope(
        await apiClient.submitMarketingDemoRequest({
          full_name: fullName.trim(),
          email: email.trim(),
          institution_name: institution.trim(),
          phone: phone.trim() || null,
          city: city.trim() || null,
          country: country.trim() ? country.trim().toUpperCase() : null,
          preferred_contact_time: contactTime.trim() || null,
          message: message.trim() || null,
          utm,
          consent: true,
          website: honeypot || null,
        }),
      );
      setStatus('success');
    } catch (caught) {
      setStatus('error');
      setServerError(
        getApiErrorMessage(
          caught,
          'Your request could not be sent right now. Please try again in a moment.',
        ),
      );
    }
  };

  if (status === 'success') {
    return (
      <div className={styles.demoFormSuccess} role="status" aria-live="polite">
        <h3>Demo request received</h3>
        <p>
          Thank you! Our team will reach out to you shortly to find a time that works. Nothing is
          booked yet — we&rsquo;ll confirm your demo appointment together.
        </p>
      </div>
    );
  }

  return (
    <form className={styles.demoForm} onSubmit={onSubmit} noValidate aria-label="Request a demo">
      {status === 'error' && serverError ? (
        <p className={styles.demoFormError} role="alert">
          {serverError}
        </p>
      ) : null}

      <div className={styles.demoFormGrid}>
        <div className={styles.demoFormField}>
          <label htmlFor={`${formId}-name`}>
            Full name <span aria-hidden="true">*</span>
          </label>
          <input
            id={`${formId}-name`}
            name="full_name"
            type="text"
            autoComplete="name"
            required
            maxLength={120}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            aria-invalid={Boolean(fieldErrors.full_name)}
            aria-describedby={fieldErrors.full_name ? `${formId}-name-error` : undefined}
          />
          {fieldErrors.full_name ? (
            <p id={`${formId}-name-error`} className={styles.demoFieldError}>
              {fieldErrors.full_name}
            </p>
          ) : null}
        </div>

        <div className={styles.demoFormField}>
          <label htmlFor={`${formId}-email`}>
            Work email <span aria-hidden="true">*</span>
          </label>
          <input
            id={`${formId}-email`}
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? `${formId}-email-error` : undefined}
          />
          {fieldErrors.email ? (
            <p id={`${formId}-email-error`} className={styles.demoFieldError}>
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className={styles.demoFormField}>
          <label htmlFor={`${formId}-institution`}>
            School / institution <span aria-hidden="true">*</span>
          </label>
          <input
            id={`${formId}-institution`}
            name="institution_name"
            type="text"
            autoComplete="organization"
            required
            maxLength={200}
            value={institution}
            onChange={(event) => setInstitution(event.target.value)}
            aria-invalid={Boolean(fieldErrors.institution_name)}
            aria-describedby={
              fieldErrors.institution_name ? `${formId}-institution-error` : undefined
            }
          />
          {fieldErrors.institution_name ? (
            <p id={`${formId}-institution-error`} className={styles.demoFieldError}>
              {fieldErrors.institution_name}
            </p>
          ) : null}
        </div>

        <div className={styles.demoFormField}>
          <label htmlFor={`${formId}-phone`}>Phone (optional)</label>
          <input
            id={`${formId}-phone`}
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={32}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>

        <div className={styles.demoFormField}>
          <label htmlFor={`${formId}-city`}>City (optional)</label>
          <input
            id={`${formId}-city`}
            name="city"
            type="text"
            autoComplete="address-level2"
            maxLength={100}
            value={city}
            onChange={(event) => setCity(event.target.value)}
          />
        </div>

        <div className={styles.demoFormField}>
          <label htmlFor={`${formId}-country`}>Country code (optional)</label>
          <input
            id={`${formId}-country`}
            name="country"
            type="text"
            placeholder="e.g. IN, AE, GB"
            maxLength={2}
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            aria-invalid={Boolean(fieldErrors.country)}
            aria-describedby={fieldErrors.country ? `${formId}-country-error` : undefined}
          />
          {fieldErrors.country ? (
            <p id={`${formId}-country-error`} className={styles.demoFieldError}>
              {fieldErrors.country}
            </p>
          ) : null}
        </div>

        <div className={styles.demoFormField}>
          <label htmlFor={`${formId}-time`}>Preferred contact time (optional)</label>
          <input
            id={`${formId}-time`}
            name="preferred_contact_time"
            type="text"
            placeholder="e.g. weekday mornings"
            maxLength={100}
            value={contactTime}
            onChange={(event) => setContactTime(event.target.value)}
          />
        </div>

        <div className={`${styles.demoFormField} ${styles.demoFormFieldWide}`}>
          <label htmlFor={`${formId}-message`}>Anything we should know? (optional)</label>
          <textarea
            id={`${formId}-message`}
            name="message"
            rows={3}
            maxLength={2000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>
      </div>

      {/* Honeypot: visually hidden, tab-skipped, ignored by humans. */}
      <div className={styles.demoFormHoneypot} aria-hidden="true">
        <label htmlFor={`${formId}-website`}>Website</label>
        <input
          id={`${formId}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </div>

      <div className={styles.demoFormConsent}>
        <input
          id={`${formId}-consent`}
          name="consent"
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          aria-invalid={Boolean(fieldErrors.consent)}
          aria-describedby={fieldErrors.consent ? `${formId}-consent-error` : undefined}
        />
        <label htmlFor={`${formId}-consent`}>
          I agree that Zero Mile Systems may contact me about this demo request. My details are
          used only for this conversation and are never shared or added to other mailing lists.
        </label>
      </div>
      {fieldErrors.consent ? (
        <p id={`${formId}-consent-error`} className={styles.demoFieldError} role="alert">
          {fieldErrors.consent}
        </p>
      ) : null}

      <div className={styles.demoFormActions}>
        <button type="submit" className={styles.primaryButton} disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Sending…' : 'Request a demo'}
        </button>
        <span className={styles.demoFormPrivacy}>
          We reply to the email you provide. No spam, no resale of your details.
        </span>
      </div>
    </form>
  );
}
