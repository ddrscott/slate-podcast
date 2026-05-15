# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-14

First tagged release. The project has been running in production at slate.ljs.app; this is the formal marker for what's there today.

### Added
- Discussion threads on topics — nested comments, member-gated to post, rendered inline on the topic page AND on slot pages when a slot has a topic attached
- Comment count next to vote count on every topic-list view, so discussion activity is visible at a glance
- Shows listing at `/[slate]/shows` with a link in the slate header nav
- "See all (N) →" link beneath the homepage topic pool when more than 20 are open
- Timezone shown next to every episode time (e.g. "7:30 PM CDT") and auto-converted to each viewer's local timezone in the browser
- Breadcrumb on every slate child page — small `← parent / current` header replacing the old "// slate name" captions

### Changed
- Homepage marquee splits side-by-side on desktop: next-up on the left (2/5), topic pool on the right (3/5). Stacks on mobile and tablet
- Homepage topic pool shows up to 20 entries (was 5)
- Topic cards in the list view click anywhere to open the topic detail page; external source URL moved out of the title into the meta row so the title only points one place
- Slate nav header now carries the slate's artwork on every child page (was only on the home page)
- Secondary upcoming-episode cards stay horizontal at every viewport — no more vertical-tile mode that wasted space on tablets

### Fixed
- Cover images on shows, hosts, and the marquee no longer crop when the asset isn't square — letterboxed with black bars instead
- Topics list on `/[slate]/topics` now lets you click into individual topics to read details

[Unreleased]: https://github.com/ddrscott/slate-podcast/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ddrscott/slate-podcast/releases/tag/v0.1.0
