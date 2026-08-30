import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeBottomBarMetrics, MIN_BOTTOM_PADDING, TABLET_MIN_WIDTH } from './bottom-bar-metrics.ts';

// Representative devices: gesture-nav phone, 3-button-nav phone, notchless
// phone, iPhone with a home indicator, and a tablet.
const PIXEL_GESTURE = { width: 412, height: 915, bottomInset: 24 };
const OLD_ANDROID = { width: 360, height: 640, bottomInset: 0 };
const IPHONE_15 = { width: 393, height: 852, bottomInset: 34 };
const IPAD = { width: 834, height: 1194, bottomInset: 20 };

test('the bar always reserves at least the reported bottom inset', () => {
  for (const device of [PIXEL_GESTURE, OLD_ANDROID, IPHONE_15, IPAD]) {
    const metrics = computeBottomBarMetrics(device);
    assert.ok(
      metrics.tabBarPaddingBottom >= device.bottomInset,
      `padding must cover the ${device.width}x${device.height} nav area`,
    );
    assert.ok(
      metrics.tabBarHeight > metrics.tabBarPaddingBottom,
      'the bar must leave room for its icons above the nav area',
    );
  }
});

test('devices reporting no inset still get a minimum padding', () => {
  assert.equal(computeBottomBarMetrics(OLD_ANDROID).tabBarPaddingBottom, MIN_BOTTOM_PADDING);
});

test('a negative/garbage inset is clamped to the minimum', () => {
  const metrics = computeBottomBarMetrics({ width: 360, height: 640, bottomInset: -12 });
  assert.equal(metrics.tabBarPaddingBottom, MIN_BOTTOM_PADDING);
  assert.equal(metrics.bottomInset, 0);
});

test('tablets are detected by their shortest edge, in both orientations', () => {
  assert.equal(computeBottomBarMetrics(IPAD).isTablet, true);
  const landscapeTablet = computeBottomBarMetrics({
    width: IPAD.height,
    height: IPAD.width,
    bottomInset: IPAD.bottomInset,
  });
  assert.equal(landscapeTablet.isTablet, true);
  assert.equal(landscapeTablet.isLandscape, true);
  assert.equal(computeBottomBarMetrics(PIXEL_GESTURE).isTablet, false);
  assert.ok(IPAD.width >= TABLET_MIN_WIDTH);
});

test('tablets get larger icons and labels than phones', () => {
  const tablet = computeBottomBarMetrics(IPAD);
  const phone = computeBottomBarMetrics(PIXEL_GESTURE);
  assert.ok(tablet.iconSize > phone.iconSize);
  assert.ok(tablet.labelFontSize > phone.labelFontSize);
});

test('a landscape phone gets a shorter bar than the same phone in portrait', () => {
  const portrait = computeBottomBarMetrics(PIXEL_GESTURE);
  const landscape = computeBottomBarMetrics({
    width: PIXEL_GESTURE.height,
    height: PIXEL_GESTURE.width,
    bottomInset: PIXEL_GESTURE.bottomInset,
  });
  assert.ok(landscape.tabBarHeight < portrait.tabBarHeight);
  assert.ok(landscape.tabBarPaddingBottom >= PIXEL_GESTURE.bottomInset);
});

test('floating elements clear the same navigation area as the bar', () => {
  const metrics = computeBottomBarMetrics(IPHONE_15);
  assert.equal(metrics.floatingOffset, metrics.tabBarPaddingBottom);
  assert.ok(metrics.floatingOffset >= IPHONE_15.bottomInset);
});
