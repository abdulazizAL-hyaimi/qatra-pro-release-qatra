package com.qatra.pro;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Executes queued synchronization outside the WebView process flow. */
public final class QatraCloudJobService extends JobService {
    private volatile Thread worker;

    @Override public boolean onStartJob(JobParameters params) {
        worker = new Thread(() -> {
            boolean retry = false;
            try {
                new QatraCloudSyncEngine(getApplicationContext()).syncNow();
            } catch (SecurityException auth) {
                retry = false;
            } catch (Exception transientFailure) {
                retry = true;
            }
            final boolean shouldRetry = retry;
            worker = null;
            jobFinished(params, shouldRetry);
        }, "qatra-cloud-sync");
        worker.start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        Thread running = worker;
        if (running != null) running.interrupt();
        worker = null;
        return true;
    }
}
