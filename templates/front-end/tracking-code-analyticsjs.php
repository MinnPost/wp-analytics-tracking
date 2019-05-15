<?php
/**
 * The template for analytics.js code
 *
 * @package WP Analytics Tracking Generator
 */
?>
<!-- Begin WP Analytics Tracking Generator analytics.js code -->
<script>
(function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
(i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
})(window,document,'script','https://www.google-analytics.com/analytics.js','ga');

ga('create', '<?php echo esc_attr( $property_id ); ?>', 'auto');
<?php if ( ! empty( $custom_dimensions ) ) : ?>
	<?php foreach ( $custom_dimensions as $key => $value ) : ?>
		ga( 'set', 'dimension<?php echo esc_attr( $key ); ?>', '<?php echo esc_html( $value ); ?>' );
	<?php endforeach; ?>
<?php endif; ?>
<?php if ( true === $clean_url_tracker_enabled ) : ?>
	<?php if ( isset( $clean_url_options ) ) : ?>
		ga('require', 'cleanUrlTracker', <?php echo $clean_url_options; ?> );
	<?php else : ?>
		ga('require', 'cleanUrlTracker');
	<?php endif; ?>
<?php endif; ?>
<?php if ( true === $event_tracker_enabled ) : ?>
	<?php if ( isset( $event_options ) ) : ?>
		ga('require', 'eventTracker', <?php echo $event_options; ?> );
	<?php else : ?>
		ga('require', 'eventTracker');
	<?php endif; ?>
<?php endif; ?>
<?php if ( true === $impression_tracker_enabled ) : ?>
	<?php if ( isset( $impression_options ) ) : ?>
		ga('require', 'impressionTracker', <?php echo $impression_options; ?> );
	<?php else : ?>
		ga('require', 'impressionTracker');
	<?php endif; ?>
<?php endif; ?>
<?php if ( true === $max_scroll_tracker_enabled ) : ?>
	<?php if ( isset( $max_scroll_options ) ) : ?>
		ga('require', 'maxScrollTracker', <?php echo $max_scroll_options; ?> );
	<?php else : ?>
		ga('require', 'maxScrollTracker');
	<?php endif; ?>
<?php endif; ?>
<?php if ( true === $media_query_tracker_enabled ) : ?>
	<?php if ( isset( $media_query_options ) ) : ?>
		ga('require', 'mediaQueryTracker', <?php echo $media_query_options; ?> );
	<?php else : ?>
		ga('require', 'mediaQueryTracker');
	<?php endif; ?>
<?php endif; ?>
<?php if ( true === $outbound_form_tracker_enabled ) : ?>
	<?php if ( isset( $outbound_form_options ) ) : ?>
		ga('require', 'outboundFormTracker', <?php echo $outbound_form_options; ?> );
	<?php else : ?>
		ga('require', 'outboundFormTracker');
	<?php endif; ?>
<?php endif; ?>
<?php if ( true === $outbound_link_tracker_enabled ) : ?>
	<?php if ( isset( $outbound_link_options ) ) : ?>
		ga('require', 'outboundLinkTracker', <?php echo $outbound_link_options; ?> );
	<?php else : ?>
		ga('require', 'outboundLinkTracker');
	<?php endif; ?>
<?php endif; ?>
<?php if ( true === $page_visibility_tracker_enabled ) : ?>
	<?php if ( isset( $page_visibility_options ) ) : ?>
		ga('require', 'pageVisibilityTracker', <?php echo $page_visibility_options; ?> );
	<?php else : ?>
		ga('require', 'pageVisibilityTracker');
	<?php endif; ?>
<?php endif; ?>
<?php if ( true === $social_widget_tracker_enabled ) : ?>
	<?php if ( isset( $social_widget_options ) ) : ?>
		ga('require', 'socialWidgetTracker', <?php echo $social_widget_options; ?> );
	<?php else : ?>
		ga('require', 'socialWidgetTracker');
	<?php endif; ?>
<?php endif; ?>
<?php if ( true === $url_change_tracker_enabled ) : ?>
	<?php if ( isset( $url_change_options ) ) : ?>
		ga('require', 'urlChangeTracker', <?php echo $url_change_options; ?> );
	<?php else : ?>
		ga('require', 'urlChangeTracker');
	<?php endif; ?>
<?php endif; ?>
<?php if ( true !== $disable_pageview ) : ?>
ga('send', 'pageview');
<?php endif; ?>
</script>
<!-- End WP Analytics Tracking Generator analytics.js code -->
