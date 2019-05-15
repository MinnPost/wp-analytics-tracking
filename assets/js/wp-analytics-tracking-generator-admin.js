"use strict";

(function ($) {
  function toggleEventFields(parent, type, heading) {
    var $toggle = $('input[type="checkbox"]', $(parent));
    $('.wp-analytics-generator-field-' + type).wrapAll('<tr class="wp-analytics-generator-fields-wrap wp-analytics-generator-fields-' + type + '-wrap"><td colspan="2"><table />');
    $('.wp-analytics-generator-fields-' + type + '-wrap').hide();

    if ('' !== heading) {
      $('.wp-analytics-generator-fields-' + type + '-wrap table').prepend('<caption>' + heading + '</caption>');
    }

    if ($toggle.is(':checked')) {
      $('.wp-analytics-generator-fields-' + type + '-wrap').show();
    }

    $toggle.on('click', function (e) {
      var checkbox = $(this);
      $('.wp-analytics-generator-fields-' + type + '-wrap').hide();

      if (checkbox.is(':checked')) {
        $('.wp-analytics-generator-fields-' + type + '-wrap').show();
      }
    });
  }

  $(document).ready(function () {
    if ($('.wp-analytics-generator-field-track-page-scroll-toggle').length > 0) {
      toggleEventFields('.wp-analytics-generator-field-track-page-scroll-toggle', 'scroll', 'Scroll depth settings');
    }

    if ($('.wp-analytics-generator-field-track-special').length > 0) {
      toggleEventFields('.wp-analytics-generator-field-track-special', 'special', '');
    }

    if ($('.wp-analytics-generator-field-track-affiliate').length > 0) {
      toggleEventFields('.wp-analytics-generator-field-track-affiliate', 'affiliate', '');
    }
  });
})(jQuery);
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImV2ZW50LXRyYWNraW5nLmpzIl0sIm5hbWVzIjpbIiQiLCJ0b2dnbGVFdmVudEZpZWxkcyIsInBhcmVudCIsInR5cGUiLCJoZWFkaW5nIiwiJHRvZ2dsZSIsIndyYXBBbGwiLCJoaWRlIiwicHJlcGVuZCIsImlzIiwic2hvdyIsIm9uIiwiZSIsImNoZWNrYm94IiwiZG9jdW1lbnQiLCJyZWFkeSIsImxlbmd0aCIsImpRdWVyeSJdLCJtYXBwaW5ncyI6Ijs7QUFBQSxDQUFDLFVBQVNBLENBQVQsRUFBVztBQUVYLFdBQVNDLGlCQUFULENBQTRCQyxNQUE1QixFQUFvQ0MsSUFBcEMsRUFBMENDLE9BQTFDLEVBQW9EO0FBQ25ELFFBQUlDLE9BQU8sR0FBR0wsQ0FBQyxDQUFDLHdCQUFELEVBQTJCQSxDQUFDLENBQUNFLE1BQUQsQ0FBNUIsQ0FBZjtBQUVBRixJQUFBQSxDQUFDLENBQUUsbUNBQW1DRyxJQUFyQyxDQUFELENBQTZDRyxPQUE3QyxDQUFzRCxpRkFBaUZILElBQWpGLEdBQXdGLGtDQUE5STtBQUNBSCxJQUFBQSxDQUFDLENBQUUsb0NBQW9DRyxJQUFwQyxHQUEyQyxPQUE3QyxDQUFELENBQXdESSxJQUF4RDs7QUFDQSxRQUFLLE9BQU9ILE9BQVosRUFBc0I7QUFDckJKLE1BQUFBLENBQUMsQ0FBRSxvQ0FBb0NHLElBQXBDLEdBQTJDLGFBQTdDLENBQUQsQ0FBOERLLE9BQTlELENBQXVFLGNBQWNKLE9BQWQsR0FBd0IsWUFBL0Y7QUFDQTs7QUFFRCxRQUFJQyxPQUFPLENBQUNJLEVBQVIsQ0FBVyxVQUFYLENBQUosRUFBNEI7QUFDM0JULE1BQUFBLENBQUMsQ0FBRSxvQ0FBb0NHLElBQXBDLEdBQTJDLE9BQTdDLENBQUQsQ0FBd0RPLElBQXhEO0FBQ0E7O0FBQ0RMLElBQUFBLE9BQU8sQ0FBQ00sRUFBUixDQUFXLE9BQVgsRUFBb0IsVUFBU0MsQ0FBVCxFQUFZO0FBQy9CLFVBQUlDLFFBQVEsR0FBR2IsQ0FBQyxDQUFDLElBQUQsQ0FBaEI7QUFFQUEsTUFBQUEsQ0FBQyxDQUFFLG9DQUFvQ0csSUFBcEMsR0FBMkMsT0FBN0MsQ0FBRCxDQUF3REksSUFBeEQ7O0FBRUEsVUFBSU0sUUFBUSxDQUFDSixFQUFULENBQVksVUFBWixDQUFKLEVBQTZCO0FBQzVCVCxRQUFBQSxDQUFDLENBQUUsb0NBQW9DRyxJQUFwQyxHQUEyQyxPQUE3QyxDQUFELENBQXdETyxJQUF4RDtBQUNBO0FBQ0QsS0FSRDtBQVNBOztBQUVEVixFQUFBQSxDQUFDLENBQUNjLFFBQUQsQ0FBRCxDQUFZQyxLQUFaLENBQWtCLFlBQVc7QUFDNUIsUUFBS2YsQ0FBQyxDQUFDLHdEQUFELENBQUQsQ0FBNERnQixNQUE1RCxHQUFxRSxDQUExRSxFQUE4RTtBQUM3RWYsTUFBQUEsaUJBQWlCLENBQUUsd0RBQUYsRUFBNEQsUUFBNUQsRUFBc0UsdUJBQXRFLENBQWpCO0FBQ0E7O0FBQ0QsUUFBS0QsQ0FBQyxDQUFDLDZDQUFELENBQUQsQ0FBaURnQixNQUFqRCxHQUEwRCxDQUEvRCxFQUFtRTtBQUNsRWYsTUFBQUEsaUJBQWlCLENBQUUsNkNBQUYsRUFBaUQsU0FBakQsRUFBNEQsRUFBNUQsQ0FBakI7QUFDQTs7QUFDRCxRQUFLRCxDQUFDLENBQUMsK0NBQUQsQ0FBRCxDQUFtRGdCLE1BQW5ELEdBQTRELENBQWpFLEVBQXFFO0FBQ3BFZixNQUFBQSxpQkFBaUIsQ0FBRSwrQ0FBRixFQUFtRCxXQUFuRCxFQUFnRSxFQUFoRSxDQUFqQjtBQUNBO0FBQ0QsR0FWRDtBQVlBLENBckNELEVBcUNHZ0IsTUFyQ0giLCJmaWxlIjoid3AtYW5hbHl0aWNzLXRyYWNraW5nLWdlbmVyYXRvci1hZG1pbi5qcyIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigkKXtcblxuXHRmdW5jdGlvbiB0b2dnbGVFdmVudEZpZWxkcyggcGFyZW50LCB0eXBlLCBoZWFkaW5nICkge1xuXHRcdHZhciAkdG9nZ2xlID0gJCgnaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdJywgJChwYXJlbnQpICk7XG5cblx0XHQkKCAnLndwLWFuYWx5dGljcy1nZW5lcmF0b3ItZmllbGQtJyArIHR5cGUgKS53cmFwQWxsKCAnPHRyIGNsYXNzPVwid3AtYW5hbHl0aWNzLWdlbmVyYXRvci1maWVsZHMtd3JhcCB3cC1hbmFseXRpY3MtZ2VuZXJhdG9yLWZpZWxkcy0nICsgdHlwZSArICctd3JhcFwiPjx0ZCBjb2xzcGFuPVwiMlwiPjx0YWJsZSAvPicpO1xuXHRcdCQoICcud3AtYW5hbHl0aWNzLWdlbmVyYXRvci1maWVsZHMtJyArIHR5cGUgKyAnLXdyYXAnICkuaGlkZSgpO1xuXHRcdGlmICggJycgIT09IGhlYWRpbmcgKSB7XG5cdFx0XHQkKCAnLndwLWFuYWx5dGljcy1nZW5lcmF0b3ItZmllbGRzLScgKyB0eXBlICsgJy13cmFwIHRhYmxlJyApLnByZXBlbmQoICc8Y2FwdGlvbj4nICsgaGVhZGluZyArICc8L2NhcHRpb24+JyApO1xuXHRcdH1cblxuXHRcdGlmICgkdG9nZ2xlLmlzKCc6Y2hlY2tlZCcpKSB7XG5cdFx0XHQkKCAnLndwLWFuYWx5dGljcy1nZW5lcmF0b3ItZmllbGRzLScgKyB0eXBlICsgJy13cmFwJyApLnNob3coKTtcblx0XHR9XG5cdFx0JHRvZ2dsZS5vbignY2xpY2snLCBmdW5jdGlvbihlKSB7XG5cdFx0XHR2YXIgY2hlY2tib3ggPSAkKHRoaXMpO1xuXG5cdFx0XHQkKCAnLndwLWFuYWx5dGljcy1nZW5lcmF0b3ItZmllbGRzLScgKyB0eXBlICsgJy13cmFwJyApLmhpZGUoKTtcblxuXHRcdFx0aWYgKGNoZWNrYm94LmlzKCc6Y2hlY2tlZCcpKSB7XG5cdFx0XHRcdCQoICcud3AtYW5hbHl0aWNzLWdlbmVyYXRvci1maWVsZHMtJyArIHR5cGUgKyAnLXdyYXAnICkuc2hvdygpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cblx0JChkb2N1bWVudCkucmVhZHkoZnVuY3Rpb24oKSB7XG5cdFx0aWYgKCAkKCcud3AtYW5hbHl0aWNzLWdlbmVyYXRvci1maWVsZC10cmFjay1wYWdlLXNjcm9sbC10b2dnbGUnKS5sZW5ndGggPiAwICkge1xuXHRcdFx0dG9nZ2xlRXZlbnRGaWVsZHMoICcud3AtYW5hbHl0aWNzLWdlbmVyYXRvci1maWVsZC10cmFjay1wYWdlLXNjcm9sbC10b2dnbGUnLCAnc2Nyb2xsJywgJ1Njcm9sbCBkZXB0aCBzZXR0aW5ncycgKTtcblx0XHR9XG5cdFx0aWYgKCAkKCcud3AtYW5hbHl0aWNzLWdlbmVyYXRvci1maWVsZC10cmFjay1zcGVjaWFsJykubGVuZ3RoID4gMCApIHtcblx0XHRcdHRvZ2dsZUV2ZW50RmllbGRzKCAnLndwLWFuYWx5dGljcy1nZW5lcmF0b3ItZmllbGQtdHJhY2stc3BlY2lhbCcsICdzcGVjaWFsJywgJycgKTtcblx0XHR9XG5cdFx0aWYgKCAkKCcud3AtYW5hbHl0aWNzLWdlbmVyYXRvci1maWVsZC10cmFjay1hZmZpbGlhdGUnKS5sZW5ndGggPiAwICkge1xuXHRcdFx0dG9nZ2xlRXZlbnRGaWVsZHMoICcud3AtYW5hbHl0aWNzLWdlbmVyYXRvci1maWVsZC10cmFjay1hZmZpbGlhdGUnLCAnYWZmaWxpYXRlJywgJycgKTtcblx0XHR9XG5cdH0pO1xuXG59KShqUXVlcnkpO1xuIl19
