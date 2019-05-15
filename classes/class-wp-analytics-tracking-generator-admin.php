<?php
/**
 * Class file for the WP_Analytics_Tracking_Generator_Admin class.
 *
 * @file
 */

if ( ! class_exists( 'WP_Analytics_Tracking_Generator' ) ) {
	die();
}

/**
 * Create default WordPress admin functionality to configure the plugin.
 */
class WP_Analytics_Tracking_Generator_Admin {

	protected $option_prefix;
	protected $version;
	protected $file;
	protected $slug;
	protected $settings;
	//protected $cache;

	/**
	* Constructor which sets up admin pages
	*
	* @param string $option_prefix
	* @param string $version
	* @param string $file
	* @param string $slug
	* @param object $settings
	* @throws \Exception
	*/
	public function __construct( $option_prefix, $version, $file, $slug, $settings ) {

		$this->option_prefix = $option_prefix;
		$this->version       = $version;
		$this->file          = $file;
		$this->slug          = $slug;
		$this->settings      = $settings;
		//$this->cache         = $cache;

		//$this->mp_mem_transients = $this->cache->mp_mem_transients;

		$this->tabs = $this->get_admin_tabs();

		$this->default_tab = 'basic_settings';

		$this->add_actions();

	}

	/**
	* Create the action hooks to create the admin page(s)
	*
	*/
	public function add_actions() {
		if ( is_admin() ) {
			add_action( 'admin_menu', array( $this, 'create_admin_menu' ) );
			add_action( 'admin_init', array( $this, 'admin_settings_form' ) );
			add_action( 'admin_enqueue_scripts', array( $this, 'admin_scripts_and_styles' ) );
		}

	}

	/**
	* Create WordPress admin options page
	*
	*/
	public function create_admin_menu() {
		$title = __( 'Analytics Tracking', 'wp-analytics-tracking-generator' );
		add_options_page( $title, $title, 'manage_options', $this->slug . '-admin', array( $this, 'show_admin_page' ) );
	}


	/**
	* Create WordPress admin options page tabs
	*
	* @return array $tabs
	*
	*/
	private function get_admin_tabs() {
		$tabs = array(
			'basic_settings'    => 'Basic Settings',
			'event_tracking'    => 'Event Tracking',
			'custom_dimensions' => 'Custom Dimensions',
			'advanced_settings' => 'Advanced Settings',
		); // this creates the tabs for the admin
		/*
		 * tabs to think about adding:
		 * plugins
		 *	ecommerce
		*/
		return $tabs;
	}

	/**
	* Display the admin settings page
	*
	* @return void
	*/
	public function show_admin_page() {
		$get_data = filter_input_array( INPUT_GET, FILTER_SANITIZE_STRING );
		?>
		<div class="wrap">
			<h1><?php _e( get_admin_page_title() , 'wp-analytics-tracking-generator' ); ?></h1>

			<?php
			$tabs = $this->tabs;
			$tab  = isset( $get_data['tab'] ) ? sanitize_key( $get_data['tab'] ) : $this->default_tab;
			$this->render_tabs( $tabs, $tab );

			switch ( $tab ) {
				default:
					require_once( plugin_dir_path( __FILE__ ) . '/../templates/admin/settings.php' );
					break;
			} // End switch().
			?>
		</div>
		<?php
	}

	/**
	* Render tabs for settings pages in admin
	* @param array $tabs
	* @param string $tab
	*/
	private function render_tabs( $tabs, $tab = '' ) {

		$get_data = filter_input_array( INPUT_GET, FILTER_SANITIZE_STRING );

		$current_tab = $tab;
		echo '<h2 class="nav-tab-wrapper">';
		foreach ( $tabs as $tab_key => $tab_caption ) {
			$active = $current_tab === $tab_key ? ' nav-tab-active' : '';
			echo sprintf( '<a class="nav-tab%1$s" href="%2$s">%3$s</a>',
				esc_attr( $active ),
				esc_url( '?page=' . $this->slug . '-admin&tab=' . $tab_key ),
				esc_html( $tab_caption )
			);
		}
		echo '</h2>';

		if ( isset( $get_data['tab'] ) ) {
			$tab = sanitize_key( $get_data['tab'] );
		} else {
			$tab = '';
		}
	}

	/**
	* Register items for the settings api
	* @return void
	*
	*/
	public function admin_settings_form() {

		$get_data = filter_input_array( INPUT_GET, FILTER_SANITIZE_STRING );
		$page     = isset( $get_data['tab'] ) ? sanitize_key( $get_data['tab'] ) : $this->default_tab;
		$section  = isset( $get_data['tab'] ) ? sanitize_key( $get_data['tab'] ) : $this->default_tab;

		require_once( plugin_dir_path( __FILE__ ) . 'class-wp-analytics-tracking-admin-settings.php' );
		$settings = new WP_Analytics_Tracking_Admin_Settings;

		$all_field_callbacks = array(
			'text'       => array( $settings, 'display_input_field' ),
			'checkboxes' => array( $settings, 'display_checkboxes' ),
			'select'     => array( $settings, 'display_select' ),
			'textarea'   => array( $settings, 'display_textarea' ),
			'link'       => array( $settings, 'display_link' ),
		);

		$this->basic_settings( 'basic_settings', 'basic_settings', $all_field_callbacks );
		$this->event_tracking( 'event_tracking', 'event_tracking', $all_field_callbacks );
		$this->custom_dimensions( 'custom_dimensions', 'custom_dimensions', $all_field_callbacks );
		$this->advanced_settings( 'advanced_settings', 'advanced_settings', $all_field_callbacks );

	}

	/**
	* Admin styles. Load the CSS and/or JavaScript for the plugin's settings
	*
	* @return void
	*/
	public function admin_scripts_and_styles() {
		wp_enqueue_script( $this->slug . '-admin', plugins_url( 'assets/js/' . $this->slug . '-admin.min.js', dirname( __FILE__ ) ), array( 'jquery' ), $this->version, true );
		wp_enqueue_style( $this->slug . '-admin', plugins_url( 'assets/css/' . $this->slug . '-admin.min.css', dirname( __FILE__ ) ), array(), $this->version, 'all' );
	}

	/**
	* Fields for the Basic Settings tab
	* This runs add_settings_section once, as well as add_settings_field and register_setting methods for each option
	*
	* @param string $page
	* @param string $section
	* @param array $callbacks
	*/
	private function basic_settings( $page, $section, $callbacks ) {
		$tabs = $this->tabs;
		foreach ( $tabs as $key => $value ) {
			if ( $key === $page ) {
				$title = $value;
			}
		}
		add_settings_section( $page, $title, null, $page );

		$settings = array(
			'tracking_code_type' => array(
				'title'    => __( 'Tracking Code Type', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['select'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type'     => 'select',
					'desc'     => '',
					'constant' => '',
					'items'    => $this->get_tracker_options(),
				),
			),
			'property_id'        => array(
				'title'    => __( 'Tracking ID', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type'     => 'text',
					'desc'     => '',
					'constant' => 'WP_ANALYTICS_TRACKING_ID',
				),
			),
			'disable_pageview'   => array(
				'title'    => __( 'Disable pageview tracking?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type' => 'checkbox',
					'desc' => 'If you check this, the tracker will not send a pageview hit to Analytics',
				),
			),
			'disable_for_roles'  => array(
				'title'    => __( 'Disable Analytics for these roles', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['checkboxes'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type'     => 'checkboxes',
					'desc'     => 'Analytics code will not be run for these roles',
					'constant' => '',
					'items'    => $this->get_role_options(),
				),
			),

		);

		foreach ( $settings as $key => $attributes ) {
			$id       = $this->option_prefix . $key;
			$name     = $this->option_prefix . $key;
			$title    = $attributes['title'];
			$callback = $attributes['callback'];
			$page     = $attributes['page'];
			$section  = $attributes['section'];
			$class    = isset( $attributes['class'] ) ? $attributes['class'] : 'wp-analytics-generator-field ' . $id;
			$args     = array_merge(
				$attributes['args'],
				array(
					'title'     => $title,
					'id'        => $id,
					'label_for' => $id,
					'name'      => $name,
					'class'     => $class,
				)
			);

			// if there is a constant and it is defined, don't run a validate function if there is one
			if ( isset( $attributes['args']['constant'] ) && defined( $attributes['args']['constant'] ) ) {
				$validate = '';
			}

			add_settings_field( $id, $title, $callback, $page, $section, $args );
			register_setting( $section, $id );
		}
	}

	/**
	* Fields for the Event Tracking tab
	* This runs add_settings_section once, as well as add_settings_field and register_setting methods for each option
	*
	* @param string $page
	* @param string $section
	* @param array $callbacks
	*/
	private function event_tracking( $page, $section, $callbacks ) {
		$tabs = $this->tabs;
		foreach ( $tabs as $key => $value ) {
			if ( $key === $page ) {
				$title = $value;
			}
		}
		add_settings_section( $page, $title, null, $page );

		$settings = array(
			'track_scroll_depth'      => array(
				'title'    => __( 'Track page scroll depth?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-track-page-scroll-toggle',
				'args'     => array(
					'type' => 'checkbox',
					'desc' => '',
				),
			),
			'minimum_height'          => array(
				'title'    => __( 'Minimum height', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-scroll wp-analytics-generator-field-scroll-minimum-height',
				'args'     => array(
					'type'     => 'text',
					'desc'     => 'Enter a pixel height for pages if applicable. Otherwise, 0 is the default.',
					'constant' => '',
				),
			),
			'scroll_depth_elements'   => array(
				'title'    => __( 'Scroll depth elements', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['textarea'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-scroll wp-analytics-generator-field-scroll-depth-elements',
				'args'     => array(
					'desc' => 'Leave this empty if you do not need to track specific HTML elements. Otherwise, add jQuery selectors separated by commas.',
					'rows' => 5,
					'cols' => '',
				),
			),
			'track_scroll_percentage' => array(
				'title'    => __( 'Track scroll percentage?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['select'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-scroll wp-analytics-generator-field-scroll-track-percentage',
				'args'     => array(
					'type'  => 'select',
					'desc'  => 'Setting this to false will cause the plugin to only track the elements above.',
					'items' => $this->get_true_false_select( 'true' ),
				),
			),
			'track_user_timing'       => array(
				'title'    => __( 'Track user timing?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['select'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-scroll wp-analytics-generator-field-scroll-track-timing',
				'args'     => array(
					'type'  => 'select',
					'desc'  => 'Setting this to false will turn off User Timing events.',
					'items' => $this->get_true_false_select( 'true' ),
				),
			),
			'track_pixel_depth'       => array(
				'title'    => __( 'Track pixel depth?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['select'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-scroll wp-analytics-generator-field-scroll-track-pixel-depth',
				'args'     => array(
					'type'  => 'select',
					'desc'  => 'Setting this to false will turn off Pixel Depth events.',
					'items' => $this->get_true_false_select( 'true' ),
				),
			),
			'non_interaction'         => array(
				'title'    => __( 'Use nonInteraction?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['select'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-scroll wp-analytics-generator-field-non-interaction',
				'args'     => array(
					'type'  => 'select',
					'desc'  => 'Scroll events will not impact bounce rate if this value is true.',
					'items' => $this->get_true_false_select( 'true' ),
				),
			),
			'track_special_links'     => array(
				'title'    => __( 'Track downloads, mailto, telephone, outbound links?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-track-special',
				'args'     => array(
					'type' => 'checkbox',
					'desc' => '',
				),
			),
			'download_regex'          => array(
				'title'    => __( 'Download regex', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-special wp-analytics-generator-field-download-regex',
				'args'     => array(
					'type'     => 'text',
					'desc'     => '',
					'constant' => '',
				),
			),
			'track_affiliate_links'   => array(
				'title'    => __( 'Track affiliate links?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-track-affiliate',
				'args'     => array(
					'type' => 'checkbox',
					'desc' => '',
				),
			),
			'affiliate_regex'         => array(
				'title'    => __( 'Affiliate regex', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-affiliate wp-analytics-generator-field-affiliate-regex',
				'args'     => array(
					'type'     => 'text',
					'desc'     => '',
					'constant' => '',
				),
			),
			'track_fragment_links'    => array(
				'title'    => __( 'Track fragment links?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-track-fragment',
				'args'     => array(
					'type' => 'checkbox',
					'desc' => 'Checking this will cause the tracker to send a pageview event when a #hash link is clicked',
				),
			),
			'track_form_submissions'  => array(
				'title'    => __( 'Track form submissions?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-track-form-submissions',
				'args'     => array(
					'type' => 'checkbox',
					'desc' => '',
				),
			),
			'track_adblocker_status'  => array(
				'title'    => __( 'Track ad blocker status?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'class'    => 'wp-analytics-generator-field-track-adblocker',
				'args'     => array(
					'type' => 'checkbox',
					'desc' => 'If checked, this will create an "off" and an "on" event. Off is if an ad blocker is not detected',
				),
			),
		);

		foreach ( $settings as $key => $attributes ) {
			$id       = $this->option_prefix . $key;
			$name     = $this->option_prefix . $key;
			$title    = $attributes['title'];
			$callback = $attributes['callback'];
			$page     = $attributes['page'];
			$section  = $attributes['section'];
			$class    = isset( $attributes['class'] ) ? $attributes['class'] : 'wp-analytics-generator-field ' . $id;
			$args     = array_merge(
				$attributes['args'],
				array(
					'title'     => $title,
					'id'        => $id,
					'label_for' => $id,
					'name'      => $name,
					'class'     => $class,
				)
			);

			// if there is a constant and it is defined, don't run a validate function if there is one
			if ( isset( $attributes['args']['constant'] ) && defined( $attributes['args']['constant'] ) ) {
				$validate = '';
			}

			add_settings_field( $id, $title, $callback, $page, $section, $args );
			register_setting( $section, $id );
		}
	}

	/**
	* Fields for the Custom Dimensions tab
	* This runs add_settings_section once, as well as add_settings_field and register_setting methods for each option
	*
	* @param string $page
	* @param string $section
	* @param array $callbacks
	*/
	private function custom_dimensions( $page, $section, $callbacks ) {
		$tabs = $this->tabs;
		foreach ( $tabs as $key => $value ) {
			if ( $key === $page ) {
				$title = $value;
			}
		}
		add_settings_section( $page, $title, null, $page );

		$settings['dimension_total_count'] = array(
			'title'    => __( 'Available Dimensions', 'wp-analytics-tracking-generator' ),
			'callback' => $callbacks['text'],
			'page'     => $page,
			'section'  => $section,
			'args'     => array(
				'type'     => 'text',
				'desc'     => 'Total count of dimensions in Analytics. Default will be 20, if this is empty.',
				'constant' => '',
			),
		);

		$i               = 1;
		$dimension_count = get_option( $this->option_prefix . 'dimension_total_count', $this->settings->dimension_count_default );
		if ( '' === $dimension_count ) {
			$dimension_count = $this->settings->dimension_count_default;
		}
		while ( $i <= $dimension_count ) {
			if ( 1 === $i ) {
				$desc = __( 'Enter a global WordPress variable for each dimension you have in Analytics. You can also use the wp_analytics_tracking_generator_add_dimension hook.', 'wp-analytics-tracking-generator' );
			} else {
				$desc = '';
			}
			$settings[ 'dimension_' . $i ] = array(
				'title'    => __( 'Dimension ', 'wp-analytics-tracking-generator' ) . $i,
				'callback' => $callbacks['select'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type'     => 'select',
					'desc'     => $desc,
					'constant' => '',
					'items'    => $this->get_dimension_variables(),
				),
			);
			$i++;
		}

		foreach ( $settings as $key => $attributes ) {
			$id       = $this->option_prefix . $key;
			$name     = $this->option_prefix . $key;
			$title    = $attributes['title'];
			$callback = $attributes['callback'];
			$page     = $attributes['page'];
			$section  = $attributes['section'];
			$class    = isset( $attributes['class'] ) ? $attributes['class'] : 'wp-analytics-generator-field ' . $id;
			$args     = array_merge(
				$attributes['args'],
				array(
					'title'     => $title,
					'id'        => $id,
					'label_for' => $id,
					'name'      => $name,
					'class'     => $class,
				)
			);

			// if there is a constant and it is defined, don't run a validate function if there is one
			if ( isset( $attributes['args']['constant'] ) && defined( $attributes['args']['constant'] ) ) {
				$validate = '';
			}

			add_settings_field( $id, $title, $callback, $page, $section, $args );
			register_setting( $section, $id );
		}
	}

	/**
	* Fields for the Advanced Settings tab
	* This runs add_settings_section once, as well as add_settings_field and register_setting methods for each option
	*
	* @param string $page
	* @param string $section
	* @param array $callbacks
	* things to track here:
	* speed sample rate / user sample rate
	* anonymize ips
	* user opt out
	* exclude users with Do Not Track header
	* enable remarketing, demographics, interests reports
	* exclude events from bounce rate and time on page calculation
	* enable enhanced link attribution
	* use hitcallback to increase event tracking accuracy
	* enable force ssl
	* enable cross domain
	* list of domains to support
	* cookie domain/name/expiration
	*/
	private function advanced_settings( $page, $section, $callbacks ) {
		$tabs = $this->tabs;
		foreach ( $tabs as $key => $value ) {
			if ( $key === $page ) {
				$title = $value;
			}
		}
		add_settings_section( $page, $title, null, $page );

		$settings = array(
			'speed_sample_rate'                => array(
				'title'    => __( 'Speed sample rate percentage', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type'     => 'text',
					'desc'     => 'If empty, the default is 1',
					'constant' => '',
				),
			),
			'user_sample_rate'                 => array(
				'title'    => __( 'User sample rate percentage', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type' => 'text',
					'desc' => 'If empty, the default is 100',
				),
			),
			'exclude_do_not_track'             => array(
				'title'    => __( 'Exclude users with Do Not Track header?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type' => 'checkbox',
					'desc' => '',
				),
			),
			'enable_extra_reports'             => array(
				'title'    => __( 'Enable remarketing, demographics, interest reports?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type' => 'checkbox',
					'desc' => '',
				),
			),
			'exclude_events_bounce'            => array(
				'title'    => __( 'Exclude events from bounce-rate and time on page?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type' => 'checkbox',
					'desc' => '',
				),
			),
			'enable_enhanced_link_attribution' => array(
				'title'    => __( 'Enable enhanced link attribution?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type' => 'checkbox',
					'desc' => '',
				),
			),
			'use_hitcallback'                  => array(
				'title'    => __( 'Use hitCallback to increase event accuracy?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type' => 'checkbox',
					'desc' => '',
				),
			),
			'enable_force_ssl'                 => array(
				'title'    => __( 'Enable Force SSL?', 'wp-analytics-tracking-generator' ),
				'callback' => $callbacks['text'],
				'page'     => $page,
				'section'  => $section,
				'args'     => array(
					'type' => 'checkbox',
					'desc' => '',
				),
			),
		);

		foreach ( $settings as $key => $attributes ) {
			$id       = $this->option_prefix . $key;
			$name     = $this->option_prefix . $key;
			$title    = $attributes['title'];
			$callback = $attributes['callback'];
			$page     = $attributes['page'];
			$section  = $attributes['section'];
			$class    = isset( $attributes['class'] ) ? $attributes['class'] : 'wp-analytics-generator-field ' . $id;
			$args     = array_merge(
				$attributes['args'],
				array(
					'title'     => $title,
					'id'        => $id,
					'label_for' => $id,
					'name'      => $name,
					'class'     => $class,
				)
			);

			// if there is a constant and it is defined, don't run a validate function if there is one
			if ( isset( $attributes['args']['constant'] ) && defined( $attributes['args']['constant'] ) ) {
				$validate = '';
			}

			add_settings_field( $id, $title, $callback, $page, $section, $args );
			register_setting( $section, $id );
		}
	}

	/**
	* Reusable <select> items with true and false, to mirror jquery settings
	*
	* @param string $default
	* @return array $items
	*/
	private function get_true_false_select( $default = '' ) {
		$items = array(
			'true'  => array(
				'id'    => 'true',
				'value' => 'true',
				'text'  => 'true',
				'desc'  => '',
			),
			'false' => array(
				'id'    => 'false',
				'value' => 'false',
				'text'  => 'false',
				'desc'  => '',
			),
		);

		foreach ( $items as $key => $value ) {
			if ( $default === $key ) {
				$items[ $key ]['default'] = true;
			}
		}

		return $items;
	}

	/**
	* Analytics trackers as setting field options
	*
	* @return array $items
	*/
	private function get_tracker_options() {
		$items    = array();
		$trackers = $this->settings->get_analytics_tracker_types();
		foreach ( $trackers as $key => $tracker ) {
			$items[] = array(
				'id'    => $key,
				'value' => $key,
				'text'  => $tracker['name'],
				'desc'  => '',
			);
		}
		return $items;
	}

	/**
	* WordPress user roles as setting field options
	*
	* @return array $items
	*/
	private function get_role_options() {
		$items = array();
		$roles = get_editable_roles();
		foreach ( $roles as $key => $role ) {
			$items[] = array(
				'id'    => $key,
				'value' => $key,
				'text'  => $role['name'],
				'desc'  => '',
			);
		}
		return $items;
	}

	/**
	* Get options for custom dimension variables
	*
	* @return array $items
	*/
	private function get_dimension_variables() {
		$items = array();
		$vars  = $this->settings->get_dimension_variables();
		foreach ( $vars as $key => $variable ) {
			$items[] = array(
				'id'    => $key,
				'value' => $key,
				'text'  => $variable['name'],
				'desc'  => '',
			);
		}
		return $items;
	}

}
