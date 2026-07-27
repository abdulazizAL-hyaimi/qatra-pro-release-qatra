package com.qatra.pro;

import android.app.job.JobParameters;
import android.app.job.JobService;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;

import java.util.Arrays;

/** Executes encrypted Google Drive backups after the user has granted Drive access once. */
public final class QatraDriveBackupJobService extends JobService {
    private volatile boolean stopped;

    @Override public boolean onStartJob(JobParameters params) {
        stopped = false;
        QatraDriveBackupManager manager = new QatraDriveBackupManager(getApplicationContext());
        if (!manager.scheduleEnabled()) return false;

        QatraGoogleDriveAccount googleAccount =
                new QatraGoogleDriveAccount(getApplicationContext());
        if (!googleAccount.hasSelectedAccount()) {
            manager.recordFailure(new SecurityException(
                    "يلزم فتح مركز النسخ واختيار حساب Google الموحد أولًا"));
            return false;
        }

        AuthorizationRequest request = AuthorizationRequest.builder()
                .setAccount(googleAccount.selectedAccount())
                .setRequestedScopes(Arrays.asList(
                        new Scope(QatraDriveBackupManager.DRIVE_SCOPE),
                        new Scope(QatraDriveBackupManager.DRIVE_APPDATA_SCOPE)))
                .build();
        Identity.getAuthorizationClient(getApplicationContext())
                .authorize(request)
                .addOnSuccessListener(result -> continueBackup(params, manager, result))
                .addOnFailureListener(error -> finishFailure(params, manager, error, true));
        return true;
    }

    private void continueBackup(JobParameters params, QatraDriveBackupManager manager,
                                AuthorizationResult authorization) {
        if (stopped) return;
        if (authorization.hasResolution() || authorization.getAccessToken() == null) {
            finishFailure(params, manager,
                    new SecurityException(
                            "يلزم فتح مركز النسخ واختيار حساب Google نفسه لإكمال النسخ التلقائي"),
                    false);
            return;
        }
        final String token = authorization.getAccessToken();
        new Thread(() -> {
            try {
                manager.uploadNow(token, "scheduled");
                if (!stopped) {
                    QatraDriveBackupScheduler.schedule(getApplicationContext());
                    jobFinished(params, false);
                }
            } catch (Exception failure) {
                if (QatraDriveBackupManager.requiresFreshAuthorization(failure)) {
                    clearInvalidToken(params, manager, token, failure);
                } else if (failure instanceof SecurityException) {
                    finishFailure(params, manager, failure, false);
                } else {
                    finishFailure(params, manager, failure, true);
                }
            }
        }, "qatra-drive-backup").start();
    }

    private void clearInvalidToken(JobParameters params, QatraDriveBackupManager manager,
                                   String token, Exception error) {
        Identity.getAuthorizationClient(getApplicationContext())
                .clearToken(ClearTokenRequest.builder().setToken(token).build())
                .addOnCompleteListener(task -> finishFailure(params, manager, error, true));
    }

    private void finishFailure(JobParameters params, QatraDriveBackupManager manager,
                               Exception error, boolean retry) {
        manager.recordFailure(error);
        if (stopped) return;
        if (!retry) QatraDriveBackupScheduler.schedule(getApplicationContext());
        jobFinished(params, retry);
    }

    @Override public boolean onStopJob(JobParameters params) {
        stopped = true;
        return true;
    }
}
