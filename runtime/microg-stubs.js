// The local microG APIs that microG itself does not implement (docs/MICROG.md section 9, "What fails explicitly"): in the pinned source (v0.3.18.252432) each of these service methods
// only logs "Not yet implemented" (or "called but not implemented") and either never answers the client or answers it without doing the work. On a phone with this microG the app sees
// exactly that, and so it does here: the method is intercepted on both engines (src/method-overrides.js setMethodInterceptor, as the entry points of src/microg-entry-points.js), the
// device records one explicit failure per method (trace "DEVICE microG UNIMPLEMENTED <id>", a Logcat warning, an entry in deviceOptions.microg.failures with its hit count) and
// microG's own body then runs. Nothing is substituted: the lab does not implement in microG's place what microG leaves undone. Every method is checked against the built DEX by
// tests/microg-entry-points.test.mjs.
//   answer 'never'   : the client's callback is never called (its Task never completes)
//   answer 'no-op'   : the client gets a success (or an empty/default result) and nothing is done
const GMS = 'com.google.android.gms';
const LM = 'Lorg/microg/gms/location/manager/LocationManagerInstance;', MI = 'Lorg/microg/gms/moduleinstall/ModuleInstallServiceImpl;', TN = 'Lorg/microg/gms/threadnetwork/ThreadNetworkServiceImpl;', BS = 'Lorg/microg/gms/auth/blockstore/BlobstoreServiceImpl;';
const STATUS = 'Lcom/google/android/gms/common/api/internal/IStatusCallback;', PENDING = 'Landroid/app/PendingIntent;', STRING = 'Ljava/lang/String;';
const LOC = 'Lcom/google/android/gms/location/', MOD = 'Lcom/google/android/gms/common/moduleinstall/internal/', THREAD = 'Lcom/google/android/gms/threadnetwork/', BLOCK = 'Lcom/google/android/gms/auth/blockstore/';
const stub = (id, api, owner, name, signature, answer, source) => ({ id, pkg: GMS, api, method: { owner, name, signature }, answer, source });
const LOCATION_SRC = 'play-services-location/core/src/main/kotlin/org/microg/gms/location/manager/LocationManagerInstance.kt';

export const MICROG_STUBS = Object.freeze([
  stub('geofences-add', 'Geofencing (GeofencingClient.addGeofences)', LM, 'addGeofences', `(${LOC}GeofencingRequest;${PENDING}${LOC}internal/IGeofencerCallbacks;)V`, 'never', LOCATION_SRC),
  stub('geofences-remove', 'Geofencing (GeofencingClient.removeGeofences by id)', LM, 'removeGeofences', `(${LOC}internal/RemoveGeofencingRequest;${LOC}internal/IGeofencerCallbacks;)V`, 'never', LOCATION_SRC),
  stub('geofences-remove-all', 'Geofencing (GeofencingClient.removeGeofences by PendingIntent)', LM, 'removeAllGeofences', `(${LOC}internal/IGeofencerCallbacks;${STRING})V`, 'never', LOCATION_SRC),
  stub('location-flush', 'Fused location: flushLocations', LM, 'flushLocations', `(${LOC}internal/IFusedLocationProviderCallback;)V`, 'never', LOCATION_SRC),
  stub('location-mock-mode', 'Fused location: setMockMode', LM, 'setMockModeWithCallback', `(Z${STATUS})V`, 'no-op', LOCATION_SRC),
  stub('location-mock-location', 'Fused location: setMockLocation', LM, 'setMockLocationWithCallback', `(Landroid/location/Location;${STATUS})V`, 'no-op', LOCATION_SRC),
  stub('activity-last', 'Activity recognition: last activity', LM, 'getLastActivity', `(${STRING})${LOC}ActivityRecognitionResult;`, 'no-op', LOCATION_SRC),
  stub('activity-transitions', 'Activity recognition: requestActivityTransitionUpdates', LM, 'requestActivityTransitionUpdates', `(${LOC}ActivityTransitionRequest;${PENDING}${STATUS})V`, 'no-op', LOCATION_SRC),
  stub('activity-transitions-remove', 'Activity recognition: removeActivityTransitionUpdates', LM, 'removeActivityTransitionUpdates', `(${PENDING}${STATUS})V`, 'no-op', LOCATION_SRC),
  stub('activity-updates', 'Activity recognition: requestActivityUpdates', LM, 'requestActivityUpdatesWithCallback', `(${LOC}ActivityRecognitionRequest;${PENDING}${STATUS})V`, 'no-op', LOCATION_SRC),
  stub('activity-updates-remove', 'Activity recognition: removeActivityUpdates', LM, 'removeActivityUpdates', `(${PENDING})V`, 'no-op', LOCATION_SRC),
  stub('sleep-segments', 'Sleep API: requestSleepSegmentUpdates', LM, 'requestSleepSegmentUpdates', `(${PENDING}${LOC}SleepSegmentRequest;${STATUS})V`, 'no-op', LOCATION_SRC),
  stub('sleep-segments-remove', 'Sleep API: removeSleepSegmentUpdates', LM, 'removeSleepSegmentUpdates', `(${PENDING}${STATUS})V`, 'no-op', LOCATION_SRC),
  stub('module-availability', 'ModuleInstall: areModulesAvailable (answers available for any module)', MI, 'areModulesAvailable', `(${MOD}IModuleInstallCallbacks;${MOD}ApiFeatureRequest;)V`, 'no-op', 'play-services-base/core/package/src/main/kotlin/org/microg/gms/moduleinstall/ModuleInstallService.kt'),
  stub('module-install', 'ModuleInstall: installModules (answers installed, installs nothing)', MI, 'installModules', `(${MOD}IModuleInstallCallbacks;${MOD}ApiFeatureRequest;${MOD}IModuleInstallStatusListener;)V`, 'no-op', 'play-services-base/core/package/src/main/kotlin/org/microg/gms/moduleinstall/ModuleInstallService.kt'),
  stub('module-install-intent', 'ModuleInstall: getInstallModulesIntent (answers CANCELED)', MI, 'getInstallModulesIntent', `(${MOD}IModuleInstallCallbacks;${MOD}ApiFeatureRequest;)V`, 'no-op', 'play-services-base/core/package/src/main/kotlin/org/microg/gms/moduleinstall/ModuleInstallService.kt'),
  stub('module-release', 'ModuleInstall: releaseModules', MI, 'releaseModules', `(${STATUS}${MOD}ApiFeatureRequest;)V`, 'no-op', 'play-services-base/core/package/src/main/kotlin/org/microg/gms/moduleinstall/ModuleInstallService.kt'),
  stub('thread-add', 'Thread network: addCredentials (stores nothing)', TN, 'addCredentials', `(${STATUS}${THREAD}ThreadBorderAgent;${THREAD}ThreadNetworkCredentials;)V`, 'no-op', 'play-services-threadnetwork/core/src/main/kotlin/org/microg/gms/threadnetwork/ThreadNetworkService.kt'),
  stub('thread-remove', 'Thread network: removeCredentials', TN, 'removeCredentials', `(${STATUS}${THREAD}ThreadBorderAgent;)V`, 'no-op', 'play-services-threadnetwork/core/src/main/kotlin/org/microg/gms/threadnetwork/ThreadNetworkService.kt'),
  stub('thread-all', 'Thread network: getAllCredentials (always empty)', TN, 'getAllCredentials', `(${THREAD}internal/IThreadNetworkServiceCallbacks;)V`, 'no-op', 'play-services-threadnetwork/core/src/main/kotlin/org/microg/gms/threadnetwork/ThreadNetworkService.kt'),
  stub('thread-preferred', 'Thread network: getPreferredCredentials (always THREAD_NETWORK_NOT_FOUND)', TN, 'getPreferredCredentials', `(${THREAD}internal/IGetPreferredCredentialsCallback;)V`, 'no-op', 'play-services-threadnetwork/core/src/main/kotlin/org/microg/gms/threadnetwork/ThreadNetworkService.kt'),
  stub('thread-by-agent', 'Thread network: getCredentialsByBorderAgent (always empty)', TN, 'getCredentialsByBorderAgent', `(${THREAD}internal/IThreadNetworkServiceCallbacks;${THREAD}ThreadBorderAgent;)V`, 'no-op', 'play-services-threadnetwork/core/src/main/kotlin/org/microg/gms/threadnetwork/ThreadNetworkService.kt'),
  stub('thread-by-panid', 'Thread network: getCredentialsByExtendedPanId (always THREAD_NETWORK_NOT_FOUND)', TN, 'getCredentialsByExtendedPanId', `(${THREAD}internal/IGetCredentialsByExtendedPanIdCallback;[B)V`, 'no-op', 'play-services-threadnetwork/core/src/main/kotlin/org/microg/gms/threadnetwork/ThreadNetworkService.kt'),
  stub('thread-is-preferred', 'Thread network: isPreferredCredentials (always THREAD_NETWORK_NOT_FOUND)', TN, 'isPreferredCredentials', `(${THREAD}internal/IIsPreferredCredentialsCallback;${THREAD}ThreadNetworkCredentials;)V`, 'no-op', 'play-services-threadnetwork/core/src/main/kotlin/org/microg/gms/threadnetwork/ThreadNetworkService.kt'),
  stub('blockstore-set-data', 'Block Store: setBlockstoreData', BS, 'setBlockstoreData', `(${BLOCK}internal/ISetBlockstoreDataCallback;[B)V`, 'never', 'play-services-auth-blockstore/core/src/main/kotlin/org/microg/gms/auth/blockstore/BlockstoreApiService.kt'),
  stub('blockstore-get-data', 'Block Store: getBlockstoreData', BS, 'getBlockstoreData', `(${BLOCK}internal/IGetBlockstoreDataCallback;)V`, 'never', 'play-services-auth-blockstore/core/src/main/kotlin/org/microg/gms/auth/blockstore/BlockstoreApiService.kt'),
  stub('blockstore-access', 'Block Store: getAccessForPackage', BS, 'getAccessForPackage', `(${BLOCK}internal/IGetAccessForPackageCallback;${STRING})V`, 'never', 'play-services-auth-blockstore/core/src/main/kotlin/org/microg/gms/auth/blockstore/BlockstoreApiService.kt'),
  stub('blockstore-set-flag', 'Block Store: setFlagWithPackage', BS, 'setFlagWithPackage', `(${STATUS}${STRING}I)V`, 'never', 'play-services-auth-blockstore/core/src/main/kotlin/org/microg/gms/auth/blockstore/BlockstoreApiService.kt'),
  stub('blockstore-clear-flag', 'Block Store: clearFlagForPackage', BS, 'clearFlagForPackage', `(${STATUS}${STRING})V`, 'never', 'play-services-auth-blockstore/core/src/main/kotlin/org/microg/gms/auth/blockstore/BlockstoreApiService.kt'),
  stub('blockstore-update-flag', 'Block Store: updateFlagForPackage', BS, 'updateFlagForPackage', `(${STATUS}${STRING}I)V`, 'never', 'play-services-auth-blockstore/core/src/main/kotlin/org/microg/gms/auth/blockstore/BlockstoreApiService.kt'),
  stub('blockstore-restore', 'Block Store: reportAppRestore', BS, 'reportAppRestore', `(${STATUS}Ljava/util/List;I${BLOCK}AppRestoreInfo;)V`, 'never', 'play-services-auth-blockstore/core/src/main/kotlin/org/microg/gms/auth/blockstore/BlockstoreApiService.kt'),
]);

/** The stub's method as the DEX names it, in smali form. */
export const microgStubMethodSmali = stub => `${stub.method.owner}->${stub.method.name}${stub.method.signature}`;
export const MICROG_STUB_ANSWERS = Object.freeze({ never: 'microG never answers: the request stays pending', 'no-op': 'microG answers without doing it' });
