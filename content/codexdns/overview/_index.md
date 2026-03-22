---
title: "Overview"
description: "What CodexDNS is, its architecture, and key features."
weight: 10
---

CodexDNS provides a server-rendered Web UI for day-to-day DNS, filtering, client, and system administration.

## Web Interface Behavior

The authenticated interface includes lightweight global feedback for foreground actions:

- A thin progress bar appears at the top of the page while navigation, save operations, and other foreground HTTP requests are in flight.
- Toast notifications report success and error outcomes without shifting the page layout.
- Local button and panel loading indicators remain in place for actions that benefit from more specific context.

This combination gives quick visibility into in-progress work while keeping the UI responsive during partial page updates and API-backed actions.
