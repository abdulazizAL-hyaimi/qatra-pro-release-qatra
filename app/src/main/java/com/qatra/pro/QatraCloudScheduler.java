package com.qatra.pro;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;

/** Native periodic scheduler; Android batches work and runs it only when a network is available. */
final class QatraCloudScheduler {
    private static final int PERIODIC_JOB_ID = 24041;
    private static final int IMMEDIATE_JOB_ID = 24042;

    private QatraCloudScheduler() { }

    static void schedule(Context context) {
        Context app = context.getApplicationContext();
        JobScheduler scheduler = (JobScheduler) app.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        ComponentName service = new ComponentName(app, QatraCloudJobService.class);
        JobInfo.Builder builder = new JobInfo.Builder(PERIODIC_JOB_ID, service)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setPeriodic(15L * 60L * 1000L)
                .setBackoffCriteria(30_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) builder.setRequiresBatteryNotLow(false);
        scheduler.schedule(builder.build());
    }

    static void runSoon(Context context) {
        Context app = context.getApplicationContext();
        JobScheduler scheduler = (JobScheduler) app.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        ComponentName service = new ComponentName(app, QatraCloudJobService.class);
        JobInfo info = new JobInfo.Builder(IMMEDIATE_JOB_ID, service)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(2_000L)
                .setOverrideDeadline(30_000L)
                .setBackoffCriteria(30_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .build();
        scheduler.schedule(info);
    }

    static void cancel(Context context) {
        JobScheduler scheduler = (JobScheduler) context.getApplicationContext()
                .getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler != null) {
            scheduler.cancel(PERIODIC_JOB_ID);
            scheduler.cancel(IMMEDIATE_JOB_ID);
        }
    }
}
