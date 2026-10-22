# Network Explorer — first version

A client-side Cytoscape.js host communications and service dependency viewer.

## Run locally

From this directory:

```bash
python -m http.server 4321
```

Or using PowerShell:
```$listener = New-Object System.Net.HttpListener

$listener.Prefixes.Add(http://localhost:8080/)

$listener.Start()

Write-Host "Server running at http://localhost:8080/"

 

while ($listener.IsListening) {

    $context = $listener.GetContext()

    $request = $context.Request

    $response = $context.Response

   

    # Map the URL path to your local folder file

    $localPath = Join-Path (Get-Location) $request.Url.LocalPath.TrimStart('/')

    if (Test-Path $localPath -PathType Leaf) {

        $bytes = [System.IO.File]::ReadAllBytes($localPath)

        $response.ContentLength64 = $bytes.Length

        $response.OutputStream.Write($bytes, 0, $bytes.Length)

    } else {

        $response.StatusCode = 404

    }

    $response.Close()

}
```

Then open http://localhost:4321 in your browser.

No npm, Node.js, server-side code, database, account or build process is required. **An internet connection is currently needed to fetch Cytoscape.js from the CDN**, but your host and communications data stay in the local browser and are not uploaded.

## Edit your data

- `data/hosts.json`: a JSON array of hosts with unique stable string `id`, string `name`, and `attributes` object. Attribute values can be arrays (recommended) or scalars. Add arbitrary attribute keys.
- `data/communications.json`: a JSON array of distinct directed communications, each with unique `id`, `source` and `target` referencing a host ID, uppercase `protocol` (`TCP` or `UDP`), and integer destination `port` (1–65535). Optional `description`.

Every connection is a separate entry. Two hosts may have zero or many links, including reverse links. The arrow represents *connection initiation*, not the direction of response packets.

The app initially loads the included sample data. To use your own files, edit the two JSON files directly, or use the Import controls. Imported data is kept in memory until you export it or reload the page. When importing the host file, all referenced host IDs in the currently loaded communications file must already exist; import changes with the same IDs first, or edit the files together on disk and reload.

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
