<?php
/*
Plugin Name: WP Analytics Tracking Generator
Description: Configurable Google Analytics tracking code generator only, no UI in WordPress.
Version: 0.0.5
Author: Jonathan Stegall
Author URI: https://code.minnpost.com
Text Domain: wp-analytics-tracking-generator
License: GPL2+
License URI: https://www.gnu.org/licenses/gpl-2.0.html
*/

class WP_Analytics_Tracking_Generator {

	/**
	* @var string
	* The plugin version
	*/
	private $version;

	/**
	* @var string
	* This file
	*/
	private $file;

	/**
	* @var string
	* The plugin's slug
	*/
	protected $slug;

	/**
	* @var string
	* The plugin's prefix for saving options
	*/
	protected $option_prefix;

	/**
	* @var object
	* Load and initialize the WP_Analytics_Tracking_Generator_Cache class
	*/
	//public $cache;

	/**
	* @var object
	* Load and initialize the WP_Analytics_Tracking_Generator_Settings class
	*/
	public $settings;

	/**
	* @var object
	* Load and initialize the WP_Analytics_Tracking_Generator_Admin class
	*/
	public $admin;

	/**
	* @var object
	* Load and initialize the WP_Analytics_Tracking_Generator_Front_End class
	*/
	public $front_end;

	/**
	 * @var object
	 * Static property to hold an instance of the class; this seems to make it reusable
	 *
	 */
	static $instance = null;

	/**
	* Load the static $instance property that holds the instance of the class.
	* This instance makes the class reusable by other plugins
	*
	* @return object
	*
	*/
	static public function get_instance() {
		if ( null === self::$instance ) {
			self::$instance = new WP_Analytics_Tracking_Generator();
		}
		return self::$instance;
	}

	/**
	 * This is our constructor
	 *
	 * @return void
	 */
	public function __construct() {

		$this->version       = '0.0.5';
		$this->file          = __FILE__;
		$this->slug          = 'wp-analytics-tracking-generator';
		$this->option_prefix = 'wp_analytics_tracking_generator_';

		// wp cache settings - can't imagine we'll need that
		//$this->cache = $this->cache();
		// settings outside the ui
		$this->settings = $this->settings();
		// admin settings
		$this->admin = $this->admin();
		// front end settings
		$this->front_end = $this->front_end();

		$this->add_actions();

	}

	/**
	* Do actions
	*
	*/
	private function add_actions() {
		add_action( 'plugins_loaded', array( $this, 'textdomain' ) );
	}

	/**
	 * Plugin cache
	 *
	 * @return object $cache
	 */
	public function cache() {
		require_once( plugin_dir_path( __FILE__ ) . 'classes/class-wp-analytics-tracking-generator-cache.php' );
		$cache = new WP_Analytics_Tracking_Generator_Cache( $this->option_prefix, $this->version, $this->file, $this->slug );
		return $cache;
	}

	/**
	 * Plugin settings
	 *
	 * @return object $settings
	 */
	public function settings() {
		require_once( plugin_dir_path( __FILE__ ) . 'classes/class-wp-analytics-tracking-generator-settings.php' );
		$settings = new WP_Analytics_Tracking_Generator_Settings( $this->option_prefix, $this->version, $this->file, $this->slug );
		return $settings;
	}

	/**
	 * Plugin admin
	 *
	 * @return object $admin
	 */
	public function admin() {
		require_once( plugin_dir_path( __FILE__ ) . 'classes/class-wp-analytics-tracking-generator-admin.php' );
		$admin = new WP_Analytics_Tracking_Generator_Admin( $this->option_prefix, $this->version, $this->file, $this->slug, $this->settings );
		add_filter( 'plugin_action_links', array( $this, 'plugin_action_links' ), 10, 2 );
		return $admin;
	}

	/**
	 * Plugin front end
	 *
	 * @return object $front_end
	 */
	public function front_end() {
		require_once( plugin_dir_path( __FILE__ ) . 'classes/class-wp-analytics-tracking-generator-front-end.php' );
		$front_end = new WP_Analytics_Tracking_Generator_Front_End( $this->option_prefix, $this->version, $this->file, $this->slug, $this->settings );
		return $front_end;
	}

	/**
	 * Load textdomain
	 *
	 * @return void
	 */
	public function textdomain() {
		load_plugin_textdomain( 'wp-analytics-tracking-generator', false, dirname( plugin_basename( __FILE__ ) ) . '/languages/' );
	}

	/**
	* Display a Settings link on the main Plugins page
	*
	* @param array $links
	* @param string $file
	* @return array $links
	* These are the links that go with this plugin's entry
	*/
	public function plugin_action_links( $links, $file ) {
		if ( plugin_basename( __FILE__ ) === $file ) {
			$settings = '<a href="' . get_admin_url() . 'options-general.php?page=' . $this->slug . '-admin">' . __( 'Settings', 'wp-analytics-tracking-generator' ) . '</a>';
			array_unshift( $links, $settings );
		}
		return $links;
	}

}

// Instantiate our class
$wp_analytics_tracking_generator = WP_Analytics_Tracking_Generator::get_instance();
