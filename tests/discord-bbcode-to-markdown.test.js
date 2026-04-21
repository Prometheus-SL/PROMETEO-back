const test = require('node:test');
const assert = require('node:assert/strict');

const { bbcodeToMarkdown } = require('../src/services/discord/newsMessenger');

test('bbcodeToMarkdown converts real CS2 MISC-only patch note', () => {
    const input = '[p]\\[ MISC ][/p][list][*][p]Fixed a bug that removed the delay between burst fire bullets.[/p][/*][/list]';
    const out = bbcodeToMarkdown(input);

    assert.equal(
        out,
        '**Misc**\n\n• Fixed a bug that removed the delay between burst fire bullets.',
    );
});

test('bbcodeToMarkdown converts real CS2 ANIMGRAPH 2 + MISC patch note preserving sections', () => {
    const input = '[p]All changes from the animgraph_2_beta build are now live.[/p][p][/p][p]\\[ ANIMGRAPH 2 ][/p][list][*][p]Minor adjustments to viewmodel animations.[/p][/*][*][p]Adjusted general weapon deploy animation logic.[/p][/*][*][p]Fixed issues with transitioning between knife attacks.[/p][/*][*][p]Fixed Elites not shooting in third-person.[/p][/*][/list][p]\n\\[ MISC ][/p][list][*][p]Fixed a bug that allowed silently climbing ladders at run speed by sporadically tapping movement keys.[/p][/*][*][p]Adjusted ground smoothing at locations where sloped ground surfaces transition to flat ground.[/p][/*][*][p]Fixed held grenades inheriting incorrect scale in some circumstances such as after being dropped and picked up.[/p][/*][*][p]Fixed a crash at halftime when transitioning from CT to T.[/p][/*][/list]';

    const out = bbcodeToMarkdown(input);

    assert.equal(
        out,
        [
            'All changes from the animgraph_2_beta build are now live.',
            '',
            '**Animgraph 2**',
            '',
            '• Minor adjustments to viewmodel animations.',
            '• Adjusted general weapon deploy animation logic.',
            '• Fixed issues with transitioning between knife attacks.',
            '• Fixed Elites not shooting in third-person.',
            '',
            '**Misc**',
            '',
            '• Fixed a bug that allowed silently climbing ladders at run speed by sporadically tapping movement keys.',
            '• Adjusted ground smoothing at locations where sloped ground surfaces transition to flat ground.',
            '• Fixed held grenades inheriting incorrect scale in some circumstances such as after being dropped and picked up.',
            '• Fixed a crash at halftime when transitioning from CT to T.',
        ].join('\n'),
    );
});

test('bbcodeToMarkdown converts [url] to masked markdown link', () => {
    const input = '[p]See [url="https://help.steampowered.com/faq"]the FAQ[/url] for details.[/p]';
    const out = bbcodeToMarkdown(input);

    assert.equal(out, 'See [the FAQ](https://help.steampowered.com/faq) for details.');
});

test('bbcodeToMarkdown supports [b], [i], [u] inline formatting', () => {
    const input = '[p][b]Bold[/b] and [i]italic[/i] and [u]underlined[/u][/p]';
    const out = bbcodeToMarkdown(input);

    assert.equal(out, '**Bold** and *italic* and __underlined__');
});

test('bbcodeToMarkdown returns empty string for non-string input', () => {
    assert.equal(bbcodeToMarkdown(null), '');
    assert.equal(bbcodeToMarkdown(undefined), '');
    assert.equal(bbcodeToMarkdown(42), '');
});

test('bbcodeToMarkdown drops [img] tags', () => {
    const input = '[p]Before[/p][img]https://x/foo.jpg[/img][p]After[/p]';
    const out = bbcodeToMarkdown(input);

    assert.equal(out, 'Before\n\nAfter');
});
