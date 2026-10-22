# Network Explorer — v3

A client-side Cytoscape.js network element communications and service dependency viewer.

## Run locally

From this directory:

```bash
python -m http.server 4321
```

Then open http://localhost:4321 in your browser.

No npm, Node.js, server-side code, database, account or build process is required. **An internet connection is currently needed to fetch Cytoscape.js from the CDN**, but your host and communications data stay in the local browser and are not uploaded.

## Edit your data

- `data/hosts.json`: a JSON array of hosts with unique stable string `id`, string `name`, and `attributes` object. Attribute values can be arrays (recommended) or scalars. Add arbitrary attribute keys.
- `data/communications.json`: a JSON array of distinct directed communications, each with unique `id`, `source` and `target` referencing a host ID, uppercase `protocol` (`TCP` or `UDP`), and integer destination `port` (1–65535). Optional `description`.

Every connection is a separate entry. Two hosts may have zero or many links, including reverse links. The arrow represents *connection initiation*, not the direction of response packets.

The app initially loads the included sample data. To use your own files, edit the three JSON files directly, or use the Import controls. Imported data is kept in memory until you export it or reload the page. When importing the host file, all referenced host IDs in the currently loaded communications file must already exist; import changes with the same IDs first, or edit the files together on disk and reload.

## Filters

1. Pick an attribute and a value and click **Add condition**.
2. Add more conditions; they use AND logic.
3. With **Include directly connected hosts** checked, nodes one hop away are also shown.
4. By default, with one or more conditions applied, only communications involving the *matched hosts* are shown. Check **Show all links between visible hosts** to include inter-neighbour links.
5. Use incoming/outgoing direction and TCP/UDP selectors to reduce the visible links.

Click hosts or arrows to inspect them. Host search highlights names, IPs, IDs and arbitrary attribute values within the current view.

## Controls and performance

- Drag hosts to adjust their positions. Positions are stored in this browser's `localStorage`, keyed by host ID.
- **Rearrange** performs a force-directed layout for up to 180 visible hosts; larger graphs use a grid to avoid lengthy layout calculations.
- **Fit diagram** fits the current view; use the mouse wheel or trackpad to zoom.
- Filtering for hundreds of hosts is cheap; navigating several thousand *simultaneously visible* links may still be crowded. Filter to a service first for a usable dependency map.

## Current limitations

- No graphical add/edit forms for hosts or communications (edit JSON or import files).
- No CSV import, backend, live network discovery, authentication, or shared edits.
- No multihop traversal or saved named views yet.
- The sample IPs, VLANs, hostnames, ports and service relationships are invented test data, not discoveries about any real environment.
- Cytoscape.js is loaded from a third-party CDN. For an entirely offline or restricted environment, download the vetted Cytoscape distribution and replace the script tag in `index.html` with a local path.

## Load-balanced services and direct member access (v2)

- Host records can have `"type": "load_balanced_service"` and their own `attributes.ip` VIP; normal hosts may use `"type": "server"` (default).
- `data/relationships.json` is a third JSON array: `{ "id": "unique", "source": "vip-id", "target": "member-id", "type": "member" }`. Membership links are **not** network traffic. Every ID must be unique across communication and relationship edges.
- Communications can target the VIP *or any member* independently, including different ports and protocols. No redirecting or inferred backend traffic.
- **Collapsed** hides membership lines, not directly connected individual members. **Expanded** shows membership lines only when both the VIP and a member are already visible from the communication filter; it does not add nodes. **Isolated** focuses on the selected VIP (or the selected member's parent VIP) and its one-hop communications.
- Import/export relationships independently. For major topology changes, edit the three local JSON files together, then reload to avoid temporarily invalid references.
- The sample includes WEB-01 → APP-VIP on TCP 443, alongside MONITOR-01 → each APP member on TCP 22.

**Scope:** `load_balanced_service` represents the logical VIP and membership group in this version; separate physical load-balancer appliances, pools per listener and many-to-many pool relationships can be added later.

## Filtering and logical membership (v3)

The filter first finds matching elements, then optionally includes their direct communication partners. Cluster membership **does not** add elements to this set. For example, filtering `service = Time Services` shows NTP hosts and their direct communication partners but does not show `APP-VIP` merely because some of those partners belong to its cluster. Expanded mode draws dashed membership links only when both endpoints are otherwise visible. Collapsed mode hides those dashed links. Isolated mode remains a deliberate exception: clicking a VIP or its member in that mode focuses the entire cluster family and its one-hop communication partners.

The “Show all links between visible hosts” option changes which communications are drawn, not which elements qualify for display.


## v5 — Site-aware automatic grouping

Automatic grouping additionally requires an exact match on the hosts’ complete `site` attribute sets. Servers at different sites will never be consolidated, even when their communication signatures and services are identical. The original grouped sample workers all belong to Civic and still group as before. Port bundling and cluster membership behaviour are unchanged.

## v4 — Automatic communication grouping and port bundling

In **Simplify diagram**, enable **Automatically group matching servers** to replace two or more eligible server nodes with a presentation-only group. Only `type: server` nodes are candidates; VIPs and logical services are never merged. For accuracy, the match is computed against the **complete loaded communications dataset**, not merely currently visible arrows: incoming/outgoing direction, exact remote node ID, TCP/UDP protocol, and destination port must all match. Candidate hosts must also have identical `service` **and `site`** attribute sets. A host assigned to multiple sites is grouped only with hosts having the exact same complete site set; missing site values match only other missing site values. Hosts at different sites are never merged into one automatic group. Servers with no communications are not auto-grouped. No hosts, memberships or communications are changed in JSON.

A group only appears when at least two of its members are visible under the current filters. Select a group and press **Expand these servers** to see the individual hosts; **Collapse expanded groups** resets manual expansions. A collapsed grouping does not replace a VIP, and links to pool members remain logically distinct from communications to the VIP.

Enable **Bundle ports between the same endpoints** to draw one arrow per displayed source/target pair instead of separate arrows. Click it to inspect the full original list, with direction, port and description. Bundles may contain several underlying same-port communications where multiple individually addressed hosts have been grouped. Disable bundling to view separate arrows, while still permitting group-level aggregation for identical members.

**Note:** grouping is a visual simplification, not a proof that two servers have identical configuration or forwarding behaviour. Internal communications between members of the same collapsed group are not drawn as a self-loop; expand that group to see them. Group layouts can be rearranged using **Rearrange**. The graph is designed for approximately 100–1,000 hosts, but actual rendering performance depends on link density.

### Try the new feature

Filter `service = Batch Processing`. WORKER-01, WORKER-02 and WORKER-03 should be displayed as a single group, with links to DB-01 and NTP-01. Click the group and choose **Expand these servers** to see the individual nodes. With **Bundle ports** enabled, the DB connection is one bundled arrow; click it to inspect the two ports used by each worker.
