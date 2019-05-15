<?php
/**
 * Class file for the WP_Analytics_Tracking_Generator_Front_End class.
 *
 * @file
 */

if ( ! class_exists( 'WP_Analytics_Tracking_Generator' ) ) {
	die();
}

/**
 * Create default WordPress front end functionality
 */
class WP_Analytics_Tracking_Generator_Front_End {

	protected $option_prefix;
	protected $version;
	protected $file;
	protected $slug;
	protected $settings;
	//protected $cache;

	/**
	* Constructor which sets up front end
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

		$this->dimension_count = get_option( $this->option_prefix . 'dimension_total_count', $this->settings->dimension_count_default );
		if ( '' === $this->dimension_count ) {
			$this->dimension_count = $this->settings->dimension_count_default;
		}

		$this->add_actions();

	}

	/**
	* Create the action hooks
	*
	*/
	public function add_actions() {
		if ( ! is_admin() ) {
			add_action( 'wp_head', array( $this, 'output_tracking_code' ), 99 );
		}
		if ( ! is_admin() ) {
			add_action( 'wp_enqueue_scripts', array( $this, 'scripts_and_styles' ) );
		}
	}

	/**
	* Output the tracking code on the page if allowed
	*
	*/
	public function output_tracking_code() {
		$show_analytics_code = $this->show_analytics_code();
		if ( true === $show_analytics_code ) {
			$type = get_option( $this->option_prefix . 'tracking_code_type', '' );
			if ( '' !== $type ) {
				$disable_pageview  = get_option( $this->option_prefix . 'disable_pageview', false );
				$disable_pageview  = filter_var( $disable_pageview, FILTER_VALIDATE_BOOLEAN );
				$property_id       = defined( 'WP_ANALYTICS_TRACKING_ID' ) ? WP_ANALYTICS_TRACKING_ID : get_option( $this->option_prefix . 'property_id', '' );
				$custom_dimensions = $this->get_custom_dimensions();
				require_once( plugin_dir_path( $this->file ) . '/templates/front-end/tracking-code-' . $type . '.php' );
			}
		}
	}

	/**
	* Front end styles. Load the CSS and/or JavaScript
	*
	* @return void
	*/
	public function scripts_and_styles() {
		wp_enqueue_script( $this->slug . '-front-end', plugins_url( $this->slug . '/assets/js/' . $this->slug . '-front-end.js', dirname( $this->file ) ), array( 'jquery' ), filemtime( plugin_dir_path( $this->file ) . 'assets/js/' . $this->slug . '-front-end.js' ), true );

		$settings = array();

		// scroll depth settings
		$scroll_enabled = filter_var( get_option( $this->option_prefix . 'track_scroll_depth', false ), FILTER_VALIDATE_BOOLEAN );
		if ( true === $scroll_enabled ) {
			$settings['scroll'] = array(
				'enabled'         => $scroll_enabled,
				'minimum_height'  => ( '' !== get_option( $this->option_prefix . 'minimum_height', 0 ) ) ? get_option( $this->option_prefix . 'minimum_height', 0 ) : 0,
				'percentage'      => ( '' !== get_option( $this->option_prefix . 'track_scroll_percentage', true ) ) ? get_option( $this->option_prefix . 'track_scroll_percentage', true ) : true,
				'user_timing'     => ( '' !== get_option( $this->option_prefix . 'track_user_timing', true ) ) ? get_option( $this->option_prefix . 'track_user_timing', true ) : true,
				'pixel_depth'     => ( '' !== get_option( $this->option_prefix . 'track_pixel_depth', true ) ) ? get_option( $this->option_prefix . 'track_pixel_depth', true ) : true,
				'non_interaction' => ( '' !== get_option( $this->option_prefix . 'non_interaction', true ) ) ? get_option( $this->option_prefix . 'non_interaction', true ) : true,
			);
			if ( ! empty( get_option( $this->option_prefix . 'scroll_depth_elements', array() ) ) ) {
				$settings['scroll']['scroll_elements'] = get_option( $this->option_prefix . 'scroll_depth_elements', array() );
			}
		}

		// special links
		$special_links_enabled = filter_var( get_option( $this->option_prefix . 'track_special_links', false ), FILTER_VALIDATE_BOOLEAN );
		if ( true === $special_links_enabled ) {
			$settings['special'] = array(
				'enabled'        => $special_links_enabled,
				'download_regex' => ( '' !== get_option( $this->option_prefix . 'download_regex', '' ) ) ? get_option( $this->option_prefix . 'download_regex', '' ) : '',
			);
		}

		// affiliate links
		$affiliate_links_enabled = filter_var( get_option( $this->option_prefix . 'track_affiliates', false ), FILTER_VALIDATE_BOOLEAN );
		if ( true === $affiliate_links_enabled ) {
			$settings['affiliate'] = array(
				'enabled'         => $affiliate_links_enabled,
				'affiliate_regex' => ( '' !== get_option( $this->option_prefix . 'affiliate_regex', '' ) ) ? get_option( $this->option_prefix . 'affiliate_regex', '' ) : '',
			);
		}

		// fragment links
		$fragment_links_enabled = filter_var( get_option( $this->option_prefix . 'track_fragment_links', false ), FILTER_VALIDATE_BOOLEAN );
		if ( true === $fragment_links_enabled ) {
			$settings['fragment'] = array(
				'enabled' => $fragment_links_enabled,
			);
		}

		// form submits
		$form_submits_enabled = filter_var( get_option( $this->option_prefix . 'track_form_submissions', false ), FILTER_VALIDATE_BOOLEAN );
		if ( true === $form_submits_enabled ) {
			$settings['form_submissions'] = array(
				'enabled' => $form_submits_enabled,
			);
		}

		// ad blocker
		$track_adblocker_enabled = filter_var( get_option( $this->option_prefix . 'track_adblocker_status', false ), FILTER_VALIDATE_BOOLEAN );
		if ( true === $track_adblocker_enabled ) {
			$settings['track_adblocker'] = array(
				'enabled' => $track_adblocker_enabled,
			);
		}

		wp_localize_script( $this->slug . '-front-end', 'analytics_tracking_settings', $settings );
		//wp_enqueue_style( $this->slug . '-front-end', plugins_url( $this->slug . '/assets/css/' . $this->slug . '-front-end.min.css', dirname( $this->file ) ), array(), $this->version, 'all' );
	}

	/**
	* Whether or not to show the analytics code on the current page to the current user
	*
	* @return bool $show_analytics_code
	*
	*/
	private function show_analytics_code() {
		$show_analytics_code = true;
		$user_id             = get_current_user_id();
		if ( 0 === $user_id ) {
			return $show_analytics_code;
		} else {
			$user_data         = get_userdata( $user_id );
			$user_roles        = $user_data->roles;
			$disable_for_roles = get_option( $this->option_prefix . 'disable_for_roles', array() );
			$user_roles_block  = array_intersect( $user_roles, $disable_for_roles );
			if ( empty( $user_roles_block ) ) {
				return $show_analytics_code;
			} else {
				$show_analytics_code = false;
			}
		}
		return $show_analytics_code;
	}

	/**
	* Custom dimensions
	*
	* @return array $custom_dimensions
	*
	*/
	private function get_custom_dimensions() {
		$custom_dimensions = array();
		$i                 = 1;
		while ( $i <= $this->dimension_count ) {
			$key    = get_option( $this->option_prefix . 'dimension_' . $i, '' );
			$array  = $this->settings->get_dimension_variables( $key );
			$method = isset( $array['method'] ) ? $array['method'] : '';
			if ( '' !== $method ) {
				$custom_dimensions[ $i ] = $method();
			}
			$i++;
		}

		$custom_dimensions = apply_filters( 'wp_analytics_tracking_generator_custom_dimensions', $custom_dimensions );

		return $custom_dimensions;
	}

}
