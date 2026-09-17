import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, test } from 'node:test';

import { collectSourceFiles } from '../theme/legibility.ts';
import {
  SCROLL_CONTAINERS,
  VIRTUALIZED_LISTS,
  maskCommentsAndStrings,
  nestedVirtualizedLists,
} from './scroll-owner.ts';

/**
 * The regression spec for "VirtualizedLists should never be nested inside
 * plain ScrollViews with the same orientation".
 *
 * Two layers, the split `theme/legibility.spec.ts` established:
 *
 * 1. unit tests pin the scanner itself — including the **exact** shape the
 *    admin trip detail screen had when the warning was reported, so the guard
 *    is proven to catch the real bug and not just a synthetic one;
 * 2. the tree pass applies it to every screen and component, so the next
 *    screen that drops a `ListScreen` inside a `<Screen>` fails here in CI
 *    instead of in a driver's console.
 */

describe('maskCommentsAndStrings', () => {
  test('blanks line and block comments so prose cannot be read as JSX', () => {
    const masked = maskCommentsAndStrings(
      ['// <Screen> is a ScrollView', 'const a = 1; /* <Screen> */', 'const b = 2;'].join('\n'),
    );
    assert.ok(!masked.includes('<Screen'), 'comments are gone');
    assert.equal(masked.split('\n').length, 3, 'line structure is preserved');
    assert.ok(masked.includes('const a = 1;'), 'code survives');
  });

  test('treats an apostrophe in JSX text as punctuation, not a string start', () => {
    const source = "<Text>Driver's stop</Text>";
    assert.equal(maskCommentsAndStrings(source), source);
  });

  test('blanks a real string so a URL cannot start a line comment', () => {
    const masked = maskCommentsAndStrings("const url = 'https://api.example.com'; // <Screen>");
    assert.ok(!masked.includes('https'), 'the literal content is gone');
    assert.ok(!masked.includes('<Screen'), 'and so is the trailing comment');
    assert.ok(masked.includes('const url ='), 'the binding survives');
  });

  test('does not run away on an unterminated apostrophe', () => {
    const source = ["<Text>Don't</Text>", '<Screen>', '  <FlatList />', '</Screen>'].join('\n');
    assert.equal(nestedVirtualizedLists(source).length, 1);
  });
});

describe('nestedVirtualizedLists', () => {
  test('flags the admin trip detail shape that caused the reported warning', () => {
    // This is the pre-fix screen, reduced to the part that matters: the
    // cockpit chrome in a `<Screen>` with the manifest's SectionList inside it.
    const before = [
      'return (',
      '  <Screen refresh={() => void refresh()} refreshing={refreshing}>',
      '    <Card title="Trip" />',
      '    <SectionTitle>Student manifest</SectionTitle>',
      '    <ManifestList manifest={data.manifest} />',
      '  </Screen>',
      ');',
    ].join('\n');

    const violations = nestedVirtualizedLists(before);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]!.list, 'ManifestList');
    assert.equal(violations[0]!.container, 'Screen');
    assert.equal(violations[0]!.line, 5, 'points at the nested list, not the scroller');
  });

  test('accepts the fix: the list owns the scroll and the chrome is its header', () => {
    const after = [
      'const cockpit = (',
      '  <>',
      '    <Card title="Trip" />',
      '  </>',
      ');',
      'if (data.manifest) {',
      '  return (',
      '    <View style={styles.flex}>',
      '      <ManifestList manifest={data.manifest} header={cockpit} />',
      '    </View>',
      '  );',
      '}',
      'return (',
      '  <Screen refresh={() => void refresh()}>',
      '    {cockpit}',
      '    <EmptyState title="No students on this route" />',
      '  </Screen>',
      ');',
    ].join('\n');

    assert.deepEqual(nestedVirtualizedLists(after), []);
  });

  test('understands self-closing scrollers and sibling (not nested) lists', () => {
    assert.deepEqual(
      nestedVirtualizedLists(['<Screen />', '<ListScreen data={rows} />'].join('\n')),
      [],
      'a self-closing <Screen /> opens no scope',
    );
    assert.deepEqual(
      nestedVirtualizedLists(
        ['<ScrollView>', '  <Text>a</Text>', '</ScrollView>', '<FlatList data={rows} />'].join(
          '\n',
        ),
      ),
      [],
      'a list after the scroller closes is fine',
    );
  });

  test('covers every scroller and every virtualized list this app has', () => {
    assert.deepEqual([...SCROLL_CONTAINERS], ['ScrollView', 'Screen']);
    // `FlatListView` / `SectionListView` are the narrowed aliases
    // `list-screen.tsx` and `ManifestList.tsx` actually render.
    for (const name of ['FlatList', 'FlatListView', 'SectionList', 'SectionListView']) {
      assert.ok(VIRTUALIZED_LISTS.includes(name as (typeof VIRTUALIZED_LISTS)[number]), name);
      assert.equal(
        nestedVirtualizedLists(`<Screen><${name} /></Screen>`).length,
        1,
        `${name} inside <Screen> must be flagged`,
      );
    }
    assert.ok(VIRTUALIZED_LISTS.includes('ManifestList'));
    assert.ok(VIRTUALIZED_LISTS.includes('ListScreen'));
  });
});

// The test script always runs from the mobile workspace root, and scanning the
// tree is the point, so the working directory is the anchor.
const mobileRoot = `${process.cwd()}/`;
const readDir = (dir: string) =>
  readdirSync(dir, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
  }));

test('no screen nests a virtualized list inside a plain ScrollView', () => {
  const failures: string[] = [];
  for (const root of ['app', 'src']) {
    for (const file of collectSourceFiles(`${mobileRoot}${root}`, readDir)) {
      for (const violation of nestedVirtualizedLists(readFileSync(file, 'utf8'))) {
        failures.push(
          `${file}:${violation.line} — <${violation.list}> is nested inside <${violation.container}> ` +
            `(${violation.snippet})`,
        );
      }
    }
  }
  assert.deepEqual(
    failures,
    [],
    'VirtualizedLists should never be nested inside plain ScrollViews with the same ' +
      'orientation — give the list the scrolling and pass the content above it as its ' +
      'ListHeaderComponent instead.',
  );
});
