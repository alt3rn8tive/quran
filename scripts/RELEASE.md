Before committing and pushing gh-pages:

1. Run `npm run release` to regenerate version.json and version all local scripts and CSS with a hash of runtime files and views.
2. Run the Karma suite and `npm run check:release`.
3. Commit the runtime changes together with index.html and version.json. Push normally; preserve history.
4. Verify the Pages build, version.json and a saved-search reload on the public URL.

Startup checks version.json without caching before Angular starts. An outdated page gets one automatic reload with a versioned document URL, preserving the complete saved-search fragment. Failed/offline checks allow the cached app to start. Views and includes carry the same release version as scripts. While the app is open, a five-minute/visibility check offers an update instead of discarding current edits. The app does not install a service worker.
