package com.qatra.pro;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

import java.util.Calendar;

/** Schedules the next user-selected local backup time; Android may defer it during Doze. */
final class QatraDriveBackupScheduler {
    private static final int JOB_ID = 24051;
    private static final long MIN_DELAY_MS = 60_000L;

    private QatraDriveBackupScheduler() { }

    static void schedule(Context context) {
        Context app = context.getApplicationContext();
        QatraDriveBackupManager manager = new QatraDriveBackupManager(app);
        if (!manager.scheduleEnabled()) {
            cancel(app);
            return;
        }
        JobScheduler scheduler = (JobScheduler) app.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        long delay = nextDelay(manager.frequencyDays(), manager.scheduleHour(), manager.scheduleMinute());
        JobInfo job = new JobInfo.Builder(JOB_ID,
                new ComponentName(app, QatraDriveBackupJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setMinimumLatency(delay)
                .setOverrideDeadline(delay + (6L * 60L * 60L * 1000L))
                .setBackoffCriteria(5L * 60L * 1000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .build();
        scheduler.schedule(job);
    }

    static void cancel(Context context) {
        JobScheduler scheduler = (JobScheduler) context.getApplicationContext()
                .getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler != null) scheduler.cancel(JOB_ID);
    }

    static long nextDelay(int frequencyDays, int hour, int minute) {
        int days = frequencyDays == 7 ? 7 : 1;
        Calendar now = Calendar.getInstance();
        Calendar next = (Calendar) now.clone();
        next.set(Calendar.HOUR_OF_DAY, Math.max(0, Math.min(23, hour)));
        next.set(Calendar.MINUTE, Math.max(0, Math.min(59, minute)));
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (!next.after(now)) next.add(Calendar.DAY_OF_YEAR, days);
        return Math.max(MIN_DELAY_MS, next.getTimeInMillis() - now.getTimeInMillis());
    }
}
