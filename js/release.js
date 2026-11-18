/* Load the current release before Angular starts; keep saved-search hashes intact. */
var QuranRelease = (function () {
    var current = document.querySelector('meta[name="quran-release"]').content;
    function refresh(build) {
        var url = new URL(window.location.href);
        url.searchParams.set('release', build);
        window.location.replace(url.href);
    }
    async function check() {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 5000);
        try {
            var response = await fetch('version.json?t=' + Date.now(), {cache: 'no-store', signal: controller.signal});
            if (!response.ok) return null;
            var version = await response.json();
            return /^[a-f0-9]{12}$/.test(version.build) ? version.build : null;
        } catch (error) { return null; }
        finally { clearTimeout(timer); }
    }
    async function start() {
        var latest = await check();
        if (latest && latest !== current && new URL(window.location.href).searchParams.get('release') !== latest) {
            refresh(latest);
            return;
        }
        QuranRelease.pending = latest && latest !== current ? latest : null;
        var loading = document.getElementById('app-loading');
        if (loading) loading.remove();
        angular.bootstrap(document, ['myApp']);
    }
    document.addEventListener('DOMContentLoaded', start);
    return {current: current, check: check, refresh: refresh};
}());
