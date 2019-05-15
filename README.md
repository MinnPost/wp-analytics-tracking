# WP Analytics Tracking Generator
Configurable Google Analytics tracking code only, no UI in WordPress. Too many plugins seem to have tracking code that is only vaguely configurable in WordPress, maybe because they focus so intensely on providing dashboards for users to see inside WordPress.

We don't need any of those dashboards, but we do need to be able to configure custom dimensions, particularly based on our own code that is in other plugins, so we need to have a number of developer hooks that other plugins don't seem to provide, at least not without paying a subscription fee.

## Autotrack

This plugin uses the [autotrack](https://github.com/googleanalytics/autotrack) library to automate tracking for common user interactions. Much of how this works is configurable.

Each autotrack plugin has settings that the library will accept. These can sometimes be configured in the WordPress admin, but always with developer hooks. Developer hooks will override the plugin settings if both exist.

### Plugins with settings configurable in the admin

1. pageVisibilityTracker
    - developer hook: `wp_analytics_tracking_generator_page_visibility_tracker_options`
2. outboundFormTracker
    - developer hook: `wp_analytics_tracking_generator_outbound_form_tracker_options`
3. mediaQueryTracker
    - developer hook: `wp_analytics_tracking_generator_media_query_tracker_options`
4. maxScrollTracker
    - developer hook: `wp_analytics_tracking_generator_max_scroll_tracker_options`
5. impressionTracker
    - developer hook: `wp_analytics_tracking_generator_impression_tracker_options`
6. eventTracker
    - developer hook: `wp_analytics_tracking_generator_event_tracker_options`
7. cleanUrlTracker
    - developer hook: `wp_analytics_tracking_generator_clean_url_tracker_options`

### Plugins where the default is usually fine

1. urlChangeTracker
    - developer hook: `wp_analytics_tracking_generator_url_change_tracker_options`
2. socialWidgetTracker
    - developer hook: `wp_analytics_tracking_generator_social_widget_tracker_options`
3. outboundLinkTracker
    - developer hook: `wp_analytics_tracking_generator_outbound_link_tracker_options`
