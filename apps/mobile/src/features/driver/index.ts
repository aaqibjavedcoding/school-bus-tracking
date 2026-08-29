/**
 * Driver entry point into the shared crew feature. The driver and conductor
 * run the same screens (today's trip, manifest, stops) — see
 * `../crew`. The only driver-specific surface is the GPS sharing panel,
 * which is available to both crew roles but aimed at the driver's device.
 */
export * from '../crew';
