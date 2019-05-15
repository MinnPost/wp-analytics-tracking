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
<?php if ( true !== $disable_pageview ) : ?>
ga('send', 'pageview');
<?php endif; ?>
</script>
<!-- End WP Analytics Tracking Generator analytics.js code -->
