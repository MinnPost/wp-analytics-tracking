(function($){

	function toggleEventFields( parent, type, heading ) {
		var $toggle = $('input[type="checkbox"]', $(parent) );

		$( '.wp-analytics-generator-field-' + type ).wrapAll( '<tr class="wp-analytics-generator-fields-wrap wp-analytics-generator-fields-' + type + '-wrap"><td colspan="2"><table />');
		$( '.wp-analytics-generator-fields-' + type + '-wrap' ).hide();
		if ( '' !== heading ) {
			$( '.wp-analytics-generator-fields-' + type + '-wrap table' ).prepend( '<caption>' + heading + '</caption>' );
		}

		if ($toggle.is(':checked')) {
			$( '.wp-analytics-generator-fields-' + type + '-wrap' ).show();
		}
		$toggle.on('click', function(e) {
			var checkbox = $(this);

			$( '.wp-analytics-generator-fields-' + type + '-wrap' ).hide();

			if (checkbox.is(':checked')) {
				$( '.wp-analytics-generator-fields-' + type + '-wrap' ).show();
			}
		});
	}

	$(document).ready(function() {
		if ( $('.wp-analytics-generator-field-track-page-scroll-toggle').length > 0 ) {
			toggleEventFields( '.wp-analytics-generator-field-track-page-scroll-toggle', 'scroll', 'Scroll depth settings' );
		}
		if ( $('.wp-analytics-generator-field-track-special').length > 0 ) {
			toggleEventFields( '.wp-analytics-generator-field-track-special', 'special', '' );
		}
		if ( $('.wp-analytics-generator-field-track-affiliate').length > 0 ) {
			toggleEventFields( '.wp-analytics-generator-field-track-affiliate', 'affiliate', '' );
		}
	});

})(jQuery);
