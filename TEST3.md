# Test3

Source: fork995/Test2 branch test3. Deployment: fork995/Test3, Pages source GitHub Actions. Stable main and existing Test2 legacy Pages from main root are unchanged.

Test3 workflow checks public Test2/test3 every five minutes (GitHub schedules may be delayed) or on manual dispatch. A changed source SHA is tested and built before replacing Test3's own Pages artifact. source-revision.txt identifies the published revision. No shared publication directory or cross-repository secret. A failed build retains the last working deployment.

UI: compact P1 identity and visible diagnosis; owner/actions/belongings in a disclosure. G1 column 145px, hours 48px, virtual rows from 64px growing with estimated title length; long text remains accessible in details. F1 current patient groups expanded with compact cards; warnings remain visible, complete instructions in Details. E2 vertical status selection and sticky actions. All existing reasons, comments, paint, confirmation steps and write verification retained. The patient home and original stylesheet are unchanged; Test3 styles are scoped.

Sessions use clevervet.mobile.test3.auth-session.v1. Preferences use clevervet.mobile.test3.preferences.v1 and clevervet.mobile.test3.demo-preferences.v1. Test2 keys are not read, migrated or removed. Stay uses the separately installable stay/clevervet-mobile-test3.user.js with independent path, transfer storage and events. Existing Test2 script is unchanged.

Both URLs have Origin https://fork995.github.io, so the backend CORS origin stays the same. Vite base ./ resolves hashed assets under each version. No OAuth redirects, PWA manifest, service worker registration or Cache API are used by this source. External origin-wide service workers are outside this verification.

No real clinical token supplied: authenticated production API calls, actual writes, Stay integration and physical iPhone/Safari require live verification. Automated mocked integration tests cover clinical payloads, restoration and rereads. Both versions use the same backend medical records; isolated browser storage does not duplicate records.
