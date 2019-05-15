( function( $ ) {

	/*
	 * Create a Google Analytics event
	 * category: Event Category
	 * label: Event Label
	 * action: Event Action
	 * value: optional
	*/
	function wp_analytics_tracking_event( type, category, action, label, value ) {
		if ( typeof ga !== 'undefined' ) {
			if ( typeof value === 'undefined' ) {
				ga( 'send', type, category, action, label );
			} else {
				ga( 'send', type, category, action, label, value );
			}
		} else {
			return;
		}
	}

	if ( 'undefined' !== typeof analytics_tracking_settings ) {
		if ( 'undefined' !== typeof analytics_tracking_settings.special && true === analytics_tracking_settings.special.enabled ) {
			// external links
			$( 'a[href^="http"]:not([href*="://' + document.domain + '"])' ).click( function() {
			    wp_analytics_tracking_event( 'event', 'Outbound links', 'Click', this.href );
			});

			// mailto links
			$( 'a[href^="mailto"]' ).click( function() {
			    wp_analytics_tracking_event( 'event', 'Mails', 'Click', this.href.substring( 7 ) );
			});

			// tel links
			$( 'a[href^="tel"]' ).click( function() {
			    wp_analytics_tracking_event( 'event', 'Telephone', 'Call', this.href.substring( 7 ) );
			});

			// internal links
			$( 'a:not([href^="(http:|https:)?//"],[href^="#"],[href^="mailto:"])' ).click( function() {
				// track downloads
				if ( '' !== analytics_tracking_settings.special.download_regex ) {
					var url = this.href;
					var checkDownload = new RegExp( "\\.(" + analytics_tracking_settings.special.download_regex + ")([\?#].*)?$", "i" );
					var isDownload = checkDownload.test( url );
					if ( true === isDownload ) {
						var checkDownloadExtension = new RegExp("\\.(" + analytics_tracking_settings.special.download_regex + ")([\?#].*)?$", "i");
						var extensionResult = checkDownloadExtension.exec( url );
						var extension = '';
						if ( null !== extensionResult ) {
							extension = extensionResult[1];
						} else {
							extension = extensionResult;
						}
						// we can't use the url for the value here, even though that would be nice, because value is supposed to be an integer
						wp_analytics_tracking_event( 'event', 'Downloads', extension, this.href );
					}
				}
			});
		}

		if ( 'undefined' !== typeof analytics_tracking_settings.affiliate && true === analytics_tracking_settings.affiliate.enabled ) {
			// any link could be an affiliate, i guess?
			$( 'a' ).click( function() {
				// track affiliates
				if ( '' !== analytics_tracking_settings.affiliate.affiliate_regex ) {
					var checkAffiliate = new RegExp( "\\.(" + analytics_tracking_settings.affiliate.affiliate_regex + ")([\?#].*)?$", "i" );
					var isAffiliate = checkAffiliate.test( url );
					if ( true === isAffiliate ) {
						wp_analytics_tracking_event( 'event', 'Affiliate', 'Click', this.href );
					}
				}
			});
		}

		// basic form submits
		if ( 'undefined' !== typeof analytics_tracking_settings.form_submissions && true === analytics_tracking_settings.form_submissions.enabled ) {
			$( 'input[type="submit"], button[type="submit"]' ).click( function( f ) {
	            var category = $( this ).data( 'ga-category' ) || 'Form';
	            var action = $( this ).data( 'ga-action' ) || 'Submit';
	            var label = $( this ).data( 'ga-label' ) || this.name || this.value;
	            wp_analytics_tracking_event( 'event', category, action, label );
	        });
		}

	}

	$( document ).ready( function() {
		if ( 'undefined' !== typeof analytics_tracking_settings.track_adblocker && true === analytics_tracking_settings.track_adblocker.enabled ) {
			if ( typeof window.adblockDetector === 'undefined' ) {
				wp_analytics_tracking_event( 'event', 'Adblock', 'On', { 'nonInteraction': 1 } );
			} else {
				window.adblockDetector.init(
					{
						debug: false,
						found: function() {
							wp_analytics_tracking_event( 'event', 'Adblock', 'On', { 'nonInteraction': 1 } );
						},
						notFound: function() {
							wp_analytics_tracking_event( 'event', 'Adblock', 'Off', { 'nonInteraction': 1 } );
						}
					}
				);
			}
		}
	});

} )( jQuery );
