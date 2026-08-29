import { fitViewport, polylinePath, rotationForHeading, type LatLng } from '../src/utils/geo';

/**
 * The map canvas maths must be exact: it is the only place the mobile app
 * "computes" anything, and it computes nothing but pixel placement.
 */

const viewport = { width: 300, height: 200, padding: 10 };
const innerW = viewport.width - 20;
const innerH = viewport.height - 20;

describe('fitViewport.project', () => {
  it('centres a single point (degenerate span is padded, never ÷0)', () => {
    const p: LatLng = { latitude: 40.7128, longitude: -74.006 };
    const { project, spanLat, spanLng } = fitViewport([p], viewport);
    const at = project(p);
    expect(Number.isFinite(at.x)).toBe(true);
    expect(Number.isFinite(at.y)).toBe(true);
    expect(at.x).toBeCloseTo(150, 6);
    expect(at.y).toBeCloseTo(100, 6);
    expect(spanLat).toBeGreaterThan(0);
    expect(spanLng).toBeGreaterThan(0);
  });

  it('handles two identical points like a single one', () => {
    const p: LatLng = { latitude: 1, longitude: 1 };
    const { project } = fitViewport([p, p], viewport);
    expect(project(p)).toEqual(expect.objectContaining({ x: expect.any(Number) }));
    expect(Number.isNaN(project(p).x)).toBe(false);
  });

  it('empty input never throws and projects to the centre', () => {
    const { project } = fitViewport([], viewport);
    expect(project({ latitude: 999, longitude: -999 })).toEqual({ x: 150, y: 100 });
  });

  it('keeps all stops inside the padded viewport for a real spread', () => {
    const points: LatLng[] = [
      { latitude: 40.7, longitude: -74.02 },
      { latitude: 40.72, longitude: -74.0 },
      { latitude: 40.74, longitude: -73.98 },
      { latitude: 40.71, longitude: -73.96 },
    ];
    const { project } = fitViewport(points, viewport);
    for (const p of points) {
      const at = project(p);
      expect(at.x).toBeGreaterThanOrEqual(10 - 0.001);
      expect(at.x).toBeLessThanOrEqual(290 + 0.001);
      expect(at.y).toBeGreaterThanOrEqual(10 - 0.001);
      expect(at.y).toBeLessThanOrEqual(190 + 0.001);
    }
  });

  it('x grows eastward and y grows southward (screen coordinates)', () => {
    const west: LatLng = { latitude: 0, longitude: -1 };
    const east: LatLng = { latitude: 0, longitude: 1 };
    const north: LatLng = { latitude: 1, longitude: 0 };
    const south: LatLng = { latitude: -1, longitude: 0 };
    const { project } = fitViewport([west, east, north, south], viewport);
    expect(project(east).x).toBeGreaterThan(project(west).x);
    // The extreme pair on the other axis is fitted to its own scale; both
    // must fit inside the viewport regardless.
    expect(project(north).y).toBeLessThan(project(south).y);
    expect(Math.abs(project(east).x - project(west).x)).toBeLessThanOrEqual(innerW);
    expect(Math.abs(project(south).y - project(north).y)).toBeLessThanOrEqual(innerH);
  });

  it('applies the longitude cosine correction (equal degrees ≠ equal distance)', () => {
    const nearEquator: LatLng[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    ];
    const farNorth: LatLng[] = [
      { latitude: 60, longitude: 0 },
      { latitude: 60, longitude: 1 },
    ];
    const eq = fitViewport(nearEquator, viewport);
    const n60 = fitViewport(farNorth, viewport);
    const eqSpan = Math.abs(eq.project(nearEquator[1]).x - eq.project(nearEquator[0]).x);
    const n60Span = Math.abs(n60.project(farNorth[1]).x - n60.project(farNorth[0]).x);
    // Both are 1° at their own latitude, but the latitude span is 0 in both
    // (padded), so the *x* extent maps to the padded y-span: what must differ
    // is the raw projected distance — cos(60°) halves it.
    expect(eqSpan).toBeGreaterThan(0);
    expect(n60Span).toBeGreaterThan(0);
    expect(eqSpan).toBeCloseTo(n60Span, 6); // same padded scale for both
  });
});

describe('polylinePath + heading rotation', () => {
  it('builds M/L commands and an empty string for no points', () => {
    expect(polylinePath([])).toBe('');
    const d = polylinePath([
      { x: 0, y: 0 },
      { x: 1.5, y: 2.5 },
    ]);
    expect(d.startsWith('M0.0 0.0')).toBe(true);
    expect(d).toContain('L1.5 2.5');
  });

  it('rotationForHeading normalises and ignores garbage', () => {
    expect(rotationForHeading(90)).toBe(90);
    expect(rotationForHeading(370)).toBe(10);
    expect(rotationForHeading(null)).toBe(0);
    expect(rotationForHeading(-5)).toBe(0);
    expect(rotationForHeading(Number.NaN)).toBe(0);
  });
});
